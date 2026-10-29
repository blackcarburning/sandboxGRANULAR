import importlib.util
import json
import pathlib
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import test_mygrain_accounts as FIXTURE
Client=FIXTURE.Client
ACCOUNTS=FIXTURE.ACCOUNTS
SERVER=FIXTURE.SERVER

SPEC=importlib.util.spec_from_file_location('approval_worker',pathlib.Path(__file__).resolve().parents[2]/'scripts/mygrain_account_approvals.py')
WORKER=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(WORKER)

class RegistrationApproval(unittest.TestCase):
    setUp=FIXTURE.AccountHTTPTests.setUp
    tearDown=FIXTURE.AccountHTTPTests.tearDown

    def request(self,name='applicant',email='user@example.com'):
        client=Client(self.server.server_address)
        status,payload,headers=client.request('POST','/mygrain/api/auth/register',data={'username':name,'password':'a-safe-test-password','email':email})
        self.assertEqual(status,202);self.assertTrue(payload['pending']);self.assertFalse(payload['authenticated']);self.assertNotIn('Set-Cookie',headers)
        return client,payload['requestId']

    def decide(self,request_id,decision='approved',actor=WORKER.OWNER,token=None):
        row=self.accounts.registration_request(request_id)
        return self.accounts.decide_registration(request_id,decision,token or row['approval_token'],actor)

    def test_pending_has_no_session_and_no_protected_access(self):
        client,request_id=self.request()
        self.assertEqual(client.login('applicant','a-safe-test-password')[0],403)
        self.assertIsNone(self.accounts.lookup_user('applicant'))
        self.assertEqual(client.request('GET','/mygrain/api/songs')[0],401)
        self.assertEqual(client.request('GET','/mygrain/api/auth/session')[1]['authenticated'],False)
        self.assertNotIn({'username':'applicant'},self.accounts.usernames())
        with self.assertRaises(ACCOUNTS.AccountError):self.accounts.new_session({'id':request_id})
        self.assertFalse((self.accounts.users_root/request_id).exists())
        with self.accounts.connection() as c:
            fake='a'*64;c.execute('INSERT INTO sessions VALUES (?,?,?)',(__import__('hashlib').sha256(fake.encode()).hexdigest(),request_id,9999999999))
        self.assertIsNone(self.accounts.session_user(fake))

    def test_approve_is_owner_only_with_correct_capability_and_idempotent(self):
        client,request_id=self.request()
        with self.assertRaises(ACCOUNTS.AccountError):self.decide(request_id,actor='123')
        with self.assertRaises(ACCOUNTS.AccountError):self.decide(request_id,token='wrong')
        self.assertEqual(self.decide(request_id)['status'],'approved')
        self.assertTrue(self.decide(request_id)['already_decided'])
        self.assertEqual(client.login('applicant','a-safe-test-password')[0],200)
        self.assertTrue((self.accounts.users_root/request_id).is_dir())
        with self.accounts.connection() as c:
            self.assertEqual(c.execute("SELECT count(*) FROM registration_outbox WHERE kind='approval_email'").fetchone()[0],1)
            self.assertEqual(c.execute('SELECT count(*) FROM registration_audit').fetchone()[0],1)
        with self.assertRaises(ACCOUNTS.AccountError):self.decide(request_id,'declined')

    def test_decline_never_activates_or_emails(self):
        client,request_id=self.request();self.decide(request_id,'declined')
        self.assertEqual(client.login('applicant','a-safe-test-password')[0],403)
        with self.accounts.connection() as c:self.assertEqual(c.execute("SELECT count(*) FROM registration_outbox WHERE kind='approval_email'").fetchone()[0],0)

    def test_email_is_required_and_no_header_injection(self):
        client=Client(self.server.server_address)
        for i,email in enumerate([None,'bad','x@example.com\r\nBcc:evil@example.com','a@-bad.example','.a@example.com','x@@example.com']):
            status,_,_=client.request('POST','/mygrain/api/auth/register',data={'username':f'bad{i}','password':'a-safe-test-password','email':email})
            self.assertEqual(status,400)
        self.assertIsNone(self.accounts.lookup_user('bad0'))

    def test_forwarded_ip_only_from_local_proxy_and_location_is_info_only(self):
        self.assertEqual(ACCOUNTS.registration_client_ip(SimpleNamespace(client_address=('198.51.100.8',1),headers={'X-Forwarded-For':'8.8.8.8'})),'198.51.100.8')
        self.assertEqual(ACCOUNTS.registration_client_ip(SimpleNamespace(client_address=('127.0.0.1',1),headers={'X-Forwarded-For':'forged, 2001:4860:4860::8888'})),'2001:4860:4860::8888')
        self.assertEqual(WORKER.location_for('127.0.0.1'),'Unavailable (private/local IP)')
        client,request_id=self.request()
        self.assertEqual(self.accounts.registration_request(request_id)['request_ip'],'127.0.0.1')
        self.decide(request_id);self.assertEqual(client.login('applicant','a-safe-test-password')[0],200)

    def test_notifications_dedupe_and_approval_email_retries(self):
        _,request_id=self.request();messages=[];emails=[]
        WORKER.poll(self.accounts,send_telegram=lambda r:messages.append(r['id']),lookup_location=lambda ip:'Test city (approximate)')
        WORKER.poll(self.accounts,send_telegram=lambda r:messages.append(r['id']))
        self.assertEqual(messages,[request_id]);self.assertFalse(emails)
        self.decide(request_id)
        def failed(r):raise RuntimeError('credential must never be recorded')
        result=WORKER.poll(self.accounts,send_mail=failed)
        self.assertEqual(len(result['failures']),1)
        self.assertFalse(WORKER.check(self.accounts)['work'])
        with self.accounts.connection() as c:
            self.assertEqual(c.execute("SELECT last_error FROM registration_outbox WHERE kind='approval_email'").fetchone()[0],'RuntimeError')
            c.execute("UPDATE registration_outbox SET next_attempt=0 WHERE kind='approval_email'")
        WORKER.poll(self.accounts,send_mail=lambda r:emails.append(r['email']))
        WORKER.poll(self.accounts,send_mail=lambda r:emails.append(r['email']))
        self.assertEqual(emails,['user@example.com'])

    def test_migration_keeps_existing_password_and_session_active(self):
        old=self.root/'old.sqlite3';password=ACCOUNTS.hash_password('legacy-test-password')
        with sqlite3.connect(old) as c:
            c.execute('CREATE TABLE users (id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,is_admin INTEGER NOT NULL DEFAULT 0,created_at REAL NOT NULL)')
            c.execute('INSERT INTO users VALUES (?,?,?,?,?)',('b'*32,'legacy',password,0,1))
            c.execute('CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at REAL)')
            c.execute('INSERT INTO sessions VALUES (?,?,?)',(__import__('hashlib').sha256(('c'*64).encode()).hexdigest(),'b'*32,9999999999))
        legacy=ACCOUNTS.Accounts(old,self.root/'old-users',{})
        legacy.initialize();self.assertEqual(legacy.session_user('c'*64)['username'],'legacy');user=legacy.login('legacy','legacy-test-password');token=legacy.new_session(user)
        legacy.initialize();self.assertEqual(legacy.session_user(token)['username'],'legacy')
        with legacy.connection() as c:self.assertEqual(c.execute("SELECT approval_status FROM users WHERE username='legacy'").fetchone()[0],'active')

    def test_concurrent_decisions_have_one_winner(self):
        _,request_id=self.request()
        def choose(decision):
            try:return self.decide(request_id,decision)['status']
            except ACCOUNTS.AccountError:return 'conflict'
        with ThreadPoolExecutor(2) as pool:results=list(pool.map(choose,['approved','declined']))
        self.assertEqual(results.count('conflict'),1)
        with self.accounts.connection() as c:self.assertEqual(c.execute('SELECT count(*) FROM registration_audit').fetchone()[0],1)

    def test_decision_cli_reports_actual_mail_queue_status(self):
        import io
        from contextlib import redirect_stdout
        from unittest.mock import patch
        _,request_id=self.request()
        r=self.accounts.registration_request(request_id)
        argv=['worker','--decide',f"mgapprove:{request_id}:{r['approval_token']}",'--actor',WORKER.OWNER]
        def run():
            output=io.StringIO()
            with patch.object(WORKER,'store',return_value=self.accounts),patch.object(WORKER,'poll',return_value={'sent':0,'failures':[]}),patch('sys.argv',argv),redirect_stdout(output):
                self.assertEqual(WORKER.main(),0)
            return json.loads(output.getvalue())['email_status']
        self.assertEqual(run(),'queued')
        with self.accounts.connection() as c:c.execute("UPDATE registration_outbox SET attempts=1 WHERE request_id=? AND kind='approval_email'",(request_id,))
        self.assertEqual(run(),'queued_for_retry')
        with self.accounts.connection() as c:c.execute("UPDATE registration_outbox SET sent_at=123 WHERE request_id=? AND kind='approval_email'",(request_id,))
        self.assertEqual(run(),'sent')

    def test_notification_buttons_fit_telegram_without_opaque_overflow(self):
        from unittest.mock import patch
        _,request_id=self.request()
        request=self.accounts.registration_request(request_id)
        with patch.object(WORKER.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{"payload":{"ok":true,"messageId":"1"}}')) as send:
            WORKER.telegram_request(request)
        argv=send.call_args.args[0]
        presentation=json.loads(argv[argv.index('--presentation')+1])
        for button in presentation['blocks'][0]['buttons']:
            self.assertNotIn('action',button)
            self.assertLessEqual(len(button['value'].encode()),64)
            self.assertRegex(button['value'],r'^mg(?:approve|deny):[a-f0-9]{32}:[a-f0-9]{16}$')

    def test_notice_repair_requeues_only_pending_and_never_activates(self):
        _,pending=self.request()
        _,approved=self.request('approved','approved@example.com')
        WORKER.poll(self.accounts,send_telegram=lambda r:None,lookup_location=lambda ip:'Test')
        self.decide(approved)
        self.assertEqual(WORKER.renotify_pending(self.accounts),{'requeued':1})
        self.assertEqual(self.accounts.registration_request(pending)['status'],'pending')
        self.assertEqual(self.accounts.registration_request(approved)['status'],'approved')
        with self.accounts.connection() as c:
            self.assertIsNotNone(c.execute("SELECT sent_at FROM registration_outbox WHERE request_id=? AND kind='owner_notification'",(approved,)).fetchone()[0])

if __name__=='__main__':unittest.main()
