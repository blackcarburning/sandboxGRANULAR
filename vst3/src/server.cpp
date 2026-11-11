#include <future>
#include "server.h"
#include <array>
#include <cctype>
#include <stdexcept>
#include <chrono>
#include <cstring>
#include <iomanip>
#include <random>
#include <sstream>
#include <vector>
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <bcrypt.h>
using Socket=SOCKET;
static constexpr Socket bad=INVALID_SOCKET;
static void closeSocket(Socket s) { closesocket(s); }
#else
#include <arpa/inet.h>
#include <sys/socket.h>
#include <netinet/tcp.h>
#include <sys/select.h>
#include <unistd.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#include <Security/SecRandom.h>
#else
#include <openssl/sha.h>
#endif
using Socket=int;
static constexpr Socket bad=-1;
static void closeSocket(Socket s) { close(s); }
#endif
namespace mygrain {
namespace {
std::string base64(const uint8_t* bytes, size_t length) {
    const char* chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    for(size_t i=0;i<length;i+=3) {
        uint32_t n=uint32_t(bytes[i])<<16;
        if(i+1<length)n|=uint32_t(bytes[i+1])<<8;
        if(i+2<length)n|=bytes[i+2];
        out+=chars[(n>>18)&63];out+=chars[(n>>12)&63];out+=i+1<length?chars[(n>>6)&63]:'=';out+=i+2<length?chars[n&63]:'=';
    }
    return out;
}
std::string acceptKey(const std::string& client) {
    const std::string input=client+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    std::array<uint8_t,20> hash{};
#ifdef _WIN32
    BCRYPT_ALG_HANDLE algorithm=nullptr;
    if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA1_ALGORITHM,nullptr,0)<0)return {};
    const auto result=BCryptHash(algorithm,nullptr,0,(PUCHAR)input.data(),ULONG(input.size()),hash.data(),ULONG(hash.size()));
    BCryptCloseAlgorithmProvider(algorithm,0);if(result<0)return {};
#elif defined(__APPLE__)
    CC_SHA1(input.data(),CC_LONG(input.size()),hash.data());
#else
    SHA1(reinterpret_cast<const unsigned char*>(input.data()),input.size(),hash.data());
#endif
    return base64(hash.data(),hash.size());
}
bool ready(Socket s, int milliseconds) {
    fd_set set;FD_ZERO(&set);FD_SET(s,&set);timeval timeout{milliseconds/1000,(milliseconds%1000)*1000};
    return select(int(s+1),&set,nullptr,nullptr,&timeout)>0;
}
bool sendAll(Socket s, const char* p, size_t length) {
    while(length) { int n=send(s,p,int(length),0);if(n<=0)return false;p+=n;length-=n; } return true;
}
bool receive(Socket s, char* p, size_t n, const std::atomic<bool>& quit) {
    auto until=std::chrono::steady_clock::now()+std::chrono::seconds(2);
    while(n && !quit.load()) {
        if(!ready(s,20)) { if(std::chrono::steady_clock::now()>until)return false;continue; }
        int got=recv(s,p,int(n),0);if(got<=0)return false;p+=got;n-=got;
    } return n==0;
}
bool sendFrame(Socket s, uint8_t opcode, const std::string& text) {
    std::string header;header+=char(0x80|opcode);
    if(text.size()<126)header+=char(text.size());
    else {header+=char(126);header+=char((text.size()>>8)&255);header+=char(text.size()&255);}
    return sendAll(s,header.data(),header.size())&&sendAll(s,text.data(),text.size());
}
std::string field(const std::string& headers, std::string name) {
    auto pos=headers.find("\r\n");
    while(pos!=std::string::npos) {
        auto end=headers.find("\r\n",pos+2);if(end==std::string::npos)break;
        auto line=headers.substr(pos+2,end-pos-2);auto colon=line.find(':');
        if(colon!=std::string::npos) {auto key=line.substr(0,colon);for(auto&c:key)c=char(std::tolower((unsigned char)c));
            if(key==name) {auto value=line.substr(colon+1);while(!value.empty()&&value.front()==' ')value.erase(0,1);return value;}}
        pos=end;
    }return {};
}
std::string clockMessage(Engine& e) {
    std::ostringstream o;o<<std::setprecision(15)<<"{\"type\":\"clock\",\"protocol\":2,\"clock\":"<<e.clock.load()<<",\"rate\":"<<e.sampleRate.load()
      <<",\"epoch\":"<<e.generation.load()<<",\"target\":"<<e.target.load()<<",\"playing\":"<<(e.playing.load()?"true":"false")
      <<",\"active\":"<<(e.active.load()?"true":"false")<<",\"armed\":"<<(e.armed.load()?"true":"false")<<",\"running\":"<<(e.running.load()?"true":"false")
      <<",\"tempo\":"<<e.tempo.load()<<",\"ppq\":"<<e.ppq.load()<<",\"numerator\":"<<e.numerator.load()<<",\"denominator\":"<<e.denominator.load()
      <<",\"musical\":"<<(e.musicalValid.load()?"true":"false")<<",\"timing\":"<<(e.hostTimingValid.load()?"true":"false")
      <<",\"offline\":"<<(e.offline.load()?"true":"false")<<",\"bufferMs\":"<<e.fillMs.load()<<",\"driftPpm\":"<<e.driftPpm.load()
      <<",\"underruns\":"<<e.underflows.load()<<",\"overflows\":"<<e.overflows.load()<<",\"received\":"<<e.received.load()<<",\"leadMs\":350"
      <<",\"prepared\":"<<(e.preparedMode.load()?"true":"false")<<",\"loopRevision\":"<<e.preparedRevision.load()
      <<",\"loopFrames\":"<<e.preparedFrames.load()<<",\"loopBeats\":"<<e.preparedBeats.load()<<",\"loopBpm\":"<<e.preparedBpm.load()
      <<",\"remoteControl\":1,\"remotePot\":1,\"projectTransfer\":2,\"projectState\":1,\"projectRevision\":"<<e.project.revision.load()<<",\"projectBytes\":"<<e.project.bytes.load()<<",\"projectRendered\":"<<(e.project.rendered.load()?"true":"false")
      <<",\"stickyArm\":true,\"browserReady\":"<<(e.browserReady.load()?"true":"false")<<",\"continuousLive\":true,\"selectRendered\":true,\"timelineJumps\":"<<e.timelineJumps.load()<<",\"cycleWraps\":"<<e.cycleWraps.load()<<",\"cycleActive\":"<<(e.hostCycleActive.load()?"true":"false")
      <<",\"cycleStart\":"<<e.hostCycleStart.load()<<",\"cycleEnd\":"<<e.hostCycleEnd.load()<<"}";
    auto text=o.str();
    if(e.fx){text.pop_back();std::ostringstream extra;extra<<",\"fx\":true,\"latencySamples\":"<<e.fx->latency(e.sampleRate.load())<<",\"latencyMs\":1000,\"mix\":"<<e.fx->mix.load()<<",\"bypass\":"<<(e.fx->bypass.load()?"true":"false")<<",\"inputPeakLeft\":"<<e.fx->inputLeft.load()<<",\"inputPeakRight\":"<<e.fx->inputRight.load()<<",\"lateReturns\":"<<e.fx->late.load()<<",\"missingBlocks\":"<<e.fx->missing.load()<<",\"inputDrops\":"<<e.fx->inputDrops.load()<<"}";text+=extra.str();}
    return text;
}
}
Server::Server(Engine& e,std::string testOrigin):engine(e),allowedTestOrigin(std::move(testOrigin)) {
    std::array<uint8_t,16> bytes{};
#ifdef _WIN32
    if(BCryptGenRandom(nullptr,bytes.data(),ULONG(bytes.size()),BCRYPT_USE_SYSTEM_PREFERRED_RNG)<0)throw std::runtime_error("Cannot create bridge key");
#elif defined(__APPLE__)
    if(SecRandomCopyBytes(kSecRandomDefault,bytes.size(),bytes.data())!=errSecSuccess)throw std::runtime_error("Cannot create bridge key");
#else
    std::random_device random;for(auto&b:bytes)b=uint8_t(random());
#endif
    std::ostringstream s;s<<std::hex<<std::setfill('0');for(auto b:bytes)s<<std::setw(2)<<int(b);key=s.str();
}
Server::~Server(){stop();}
bool Server::start(){if(thread.joinable())return true;quit.store(false);thread=std::thread(&Server::loop,this);return true;}
void Server::stop(){quit.store(true);engine.connected.store(false);engine.requestPause();if(thread.joinable())thread.join();boundPort.store(0);}
void Server::loop() {
#ifdef _WIN32
    WSADATA wsa{};if(WSAStartup(MAKEWORD(2,2),&wsa))return;
    struct WsaGuard { ~WsaGuard(){WSACleanup();} } wsaGuard;
#endif
    Socket listener=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);
    if(listener==bad)return;
    sockaddr_in address{};address.sin_family=AF_INET;address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    bool bound=false;
    for(uint16_t p=18731;p<=18762;++p){address.sin_port=htons(p);if(bind(listener,(sockaddr*)&address,sizeof(address))==0){boundPort.store(p);bound=true;break;}}
    if(!bound||listen(listener,2)!=0){closeSocket(listener);boundPort.store(0);return;}
    while(!quit.load()) {
        if(!ready(listener,20))continue;
        Socket client=accept(listener,nullptr,nullptr);if(client==bad)continue;
#ifdef __APPLE__
        int noSigPipe=1;setsockopt(client,SOL_SOCKET,SO_NOSIGPIPE,&noSigPipe,sizeof(noSigPipe));
#endif
        // Bounded send time: closing an editor/DAW must never wait on a browser.
#ifdef _WIN32
        DWORD timeout=500;setsockopt(client,SOL_SOCKET,SO_SNDTIMEO,(const char*)&timeout,sizeof(timeout));
#else
        timeval timeout{0,500000};setsockopt(client,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
#endif
        int noDelay=1;setsockopt(client,IPPROTO_TCP,TCP_NODELAY,(const char*)&noDelay,sizeof(noDelay));
        std::string headers;char ch=0;
        const auto handshakeDeadline=std::chrono::steady_clock::now()+std::chrono::seconds(3);
        while(std::chrono::steady_clock::now()<handshakeDeadline && headers.size()<8192 && headers.find("\r\n\r\n")==std::string::npos && receive(client,&ch,1,quit))headers+=ch;
        const std::string expected="GET /stream?token="+key+" HTTP/1.1\r\n";
        const auto origin=field(headers,"origin"),clientKey=field(headers,"sec-websocket-key");
        const bool originOk=origin=="https://openclaw.blackcarburning.com" || (!allowedTestOrigin.empty()&&origin==allowedTestOrigin);
        auto upgrade=field(headers,"upgrade");for(auto&c:upgrade)c=char(std::tolower((unsigned char)c));
        if(headers.rfind(expected,0)!=0 || !originOk || clientKey.size()!=24 || upgrade!="websocket" || field(headers,"sec-websocket-version")!="13") {
            const std::string denied="HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";sendAll(client,denied.data(),denied.size());closeSocket(client);continue;
        }
        const std::string response="HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+acceptKey(clientKey)+"\r\n\r\n";
        if(!sendAll(client,response.data(),response.size())){closeSocket(client);continue;}
        engine.remote.disconnect();engine.browserReady.store(false);engine.connected.store(true);engine.requestPause();
        uint32_t packetEpoch=0,packetRate=0;uint64_t expectedFrame=0;
        uint32_t uploadId=0,uploadRate=0,uploadFrames=0,uploadCursor=0;
        double uploadBeats=0,uploadBpm=120;std::vector<float> upload;
        uint32_t projectId=0,projectSize=0,projectCursor=0,projectHash=0;bool projectRendered=false,projectDelta=false;uint32_t projectBaseRevision=0;
        std::vector<uint8_t> projectUpload;std::future<bool> projectJob;uint32_t jobId=0;
        uint32_t storedId=0,storedRevision=0,storedDirty=0;
        uint32_t downloadId=0,downloadCursor=0;std::shared_ptr<const SavedProject> download;
        auto projectDeadline=std::chrono::steady_clock::now();
        auto lastClock=std::chrono::steady_clock::now()-std::chrono::seconds(1);
        bool live=true;
        try {
        while(live&&!quit.load()&&engine.connected.load()) {
            const auto now=std::chrono::steady_clock::now();
            if(projectJob.valid()&&projectJob.wait_for(std::chrono::seconds(0))==std::future_status::ready){
                const bool ok=projectJob.get();
                if(ok){storedId=jobId;storedRevision=engine.project.revision.load();storedDirty=engine.project.dirtyRevision.load();}
                else if(!sendFrame(client,1,"{\"type\":\"projectError\",\"id\":"+std::to_string(jobId)+",\"message\":\"Snapshot rejected or project changed; previous snapshot retained.\"}"))break;
                jobId=0;
            }
            const auto remote=engine.remote.next();
            if(remote.id&&!sendFrame(client,1,"{\"type\":\"remoteCommand\",\"id\":"+std::to_string(remote.id)+",\"action\":"+std::to_string(remote.action)+",\"index\":"+std::to_string(remote.index)+",\"value\":"+std::to_string(remote.value)+"}"))break;

            if(now-lastClock>=std::chrono::milliseconds(25)){if(!sendFrame(client,1,clockMessage(engine)))break;lastClock=now;}
            // Ready means the snapshot is complete AND the UI-thread host dirty
            // notification has landed (when that optional host interface exists).
            if(storedId&&(!engine.project.supportsDirty.load()||engine.project.dirtyNotified.load(std::memory_order_acquire)>=storedDirty)){
                if(!sendFrame(client,1,"{\"type\":\"projectStored\",\"id\":"+std::to_string(storedId)+",\"revision\":"+std::to_string(storedRevision)+"}"))break;storedId=0;
            }
            if(projectId&&now>projectDeadline){projectId=0;projectUpload.clear();if(!sendFrame(client,1,"{\"type\":\"projectError\",\"message\":\"Snapshot upload expired; previous snapshot retained.\"}"))break;}
            // Send at most one bounded chunk per turn; never monopolize the FX
            // return/clock loop or buffer a full snapshot in the network stack.
            if(download){
                uint32_t n=std::min<uint32_t>(32752,uint32_t(download->document.size())-downloadCursor);
                std::string packet(16+n,'\0');uint32_t h[4]{0x3153474d,downloadId,downloadCursor,n};
                std::memcpy(packet.data(),h,16);std::memcpy(packet.data()+16,download->document.data()+downloadCursor,n);
                if(!sendFrame(client,2,packet))break;downloadCursor+=n;
                if(downloadCursor==download->document.size())download.reset();
            }
            // An active owner must never be displaced or leave a second socket
            // queued to take over later. Reject duplicates across profiles/browsers.
            if(ready(listener,0)){
                Socket duplicate=accept(listener,nullptr,nullptr);
                if(duplicate!=bad){
#ifdef __APPLE__
                    int noSigPipe=1;setsockopt(duplicate,SOL_SOCKET,SO_NOSIGPIPE,&noSigPipe,sizeof(noSigPipe));
#endif
                    const char busy[]="HTTP/1.1 409 Conflict\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    sendAll(duplicate,busy,sizeof(busy)-1);closeSocket(duplicate);
                }
            }
            if(engine.fx){
                auto& queue=engine.fx->input;
                while(queue.size()&&queue.front().epoch!=engine.generation.load())queue.pop();
                if(queue.size()){
                    const auto first=queue.front();const uint32_t rate=uint32_t(std::llround(engine.sampleRate.load()));
                    std::string packet(24+1024*8,'\0');uint32_t n=0;float samples[2048]{};
                    while(queue.size()&&n<1024){const auto value=queue.front();if(value.epoch!=first.epoch||value.frame!=first.frame+n)break;samples[n*2]=value.l;samples[n*2+1]=value.r;n++;queue.pop();}
                    const uint32_t magic=0x3349474d;const double frame=double(first.frame);
                    packet.resize(24+size_t(n)*8);std::memcpy(packet.data(),&magic,4);std::memcpy(packet.data()+4,&first.epoch,4);std::memcpy(packet.data()+8,&rate,4);std::memcpy(packet.data()+12,&n,4);std::memcpy(packet.data()+16,&frame,8);std::memcpy(packet.data()+24,samples,size_t(n)*8);
                    if(!sendFrame(client,2,packet))break;
                }
            }
            if(!ready(client,2))continue;
            std::array<unsigned char,2> head{};if(!receive(client,(char*)head.data(),2,quit))break;
            const uint8_t opcode=head[0]&15;uint64_t length=head[1]&127;
            if(!(head[0]&128)||(head[0]&0x70)||!(head[1]&128)||opcode==8)break;
            if(length==126){std::array<unsigned char,2>b{};if(!receive(client,(char*)b.data(),2,quit))break;length=uint64_t(b[0])*256+b[1];}
            else if(length==127)break;
            if(length>32800 || (opcode!=1&&opcode!=2&&opcode!=9&&opcode!=10) || ((opcode==9||opcode==10)&&length>125))break;
            std::array<unsigned char,4>mask{};if(!receive(client,(char*)mask.data(),4,quit))break;
            std::vector<char> payload(size_t(length),0);if(!receive(client,payload.data(),payload.size(),quit))break;
            for(size_t i=0;i<payload.size();++i)payload[i]^=char(mask[i%4]);
            if(opcode==9){live=sendFrame(client,10,std::string(payload.begin(),payload.end()));continue;}if(opcode==10)continue;
            if(opcode==1){const std::string cmd(payload.begin(),payload.end());
                if(cmd.rfind("companion-state:",0)==0){
                    if(cmd.size()>2300)break;std::string data=cmd.substr(16);std::array<uint64_t,14> fields{};bool valid=true;
                    for(auto& value:fields){auto end=data.find(':');if(end==std::string::npos||!end||end>16){valid=false;break;}auto n=data.substr(0,end);if(!std::all_of(n.begin(),n.end(),[](unsigned char c){return std::isdigit(c);})){valid=false;break;}value=std::stoull(n);data.erase(0,end+1);}
                    if(!valid||data.size()>2000||data.size()%2)break;
                    std::string text;auto hex=[](char c)->int{if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;return -1;};
                    for(size_t i=0;i<data.size();i+=2){int a=hex(data[i]),b=hex(data[i+1]);if(a<0||b<0){valid=false;break;}char c=char(a*16+b);if((unsigned char)c<32||c==127){valid=false;break;}text+=c;}
                    if(!valid||!engine.remote.companion(fields,std::move(text)))break;continue;
                }
                if(cmd.rfind("remote-state:",0)==0){
                    if(cmd.size()>1100)break;std::string data=cmd.substr(13);uint32_t fields[8]{};bool valid=true;
                    for(auto& value:fields){const auto end=data.find(':');if(end==std::string::npos||!end||end>10){valid=false;break;}const auto n=data.substr(0,end);if(!std::all_of(n.begin(),n.end(),[](unsigned char c){return std::isdigit(c);})){valid=false;break;}auto number=std::stoull(n);if(number>UINT32_MAX){valid=false;break;}value=uint32_t(number);data.erase(0,end+1);}
                    if(!valid||fields[1]>1||fields[7]>1||data.size()>840||data.size()%2)break;
                    std::string text;auto hex=[](char c)->int{if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;return -1;};
                    for(size_t i=0;i<data.size();i+=2){int a=hex(data[i]),b=hex(data[i+1]);if(a<0||b<0){valid=false;break;}char c=char(a*16+b);if((unsigned char)c<32||c==127){valid=false;break;}text+=c;}
                    if(!valid||!engine.remote.update(fields[0],fields[1],fields[2],fields[3],fields[4],fields[5],fields[6],fields[7],std::move(text)))break;continue;
                }
                if(cmd.rfind("project-begin:",0)==0||cmd.rfind("project-delta:",0)==0){
                    projectDelta=cmd.rfind("project-delta:",0)==0;auto fields=cmd.substr(14);std::replace(fields.begin(),fields.end(),':',' ');std::istringstream input(fields);uint64_t id=0,size=0,crc=0,mode=0,base=0;std::string trailing;
                    if(cmd.size()>120||projectJob.valid()||storedId||!(input>>id>>size>>crc>>mode)||(projectDelta&&!(input>>base))||(input>>trailing)||!id||id>UINT32_MAX||size<20||size>maxProjectBytes||crc>UINT32_MAX||mode>1||(engine.fx&&mode)||base>UINT32_MAX||(projectDelta&&(base!=engine.project.revision.load()||!engine.project.get())))break;
                    projectBaseRevision=projectDelta?uint32_t(base):engine.project.revision.load();projectId=uint32_t(id);projectSize=uint32_t(size);projectHash=uint32_t(crc);projectRendered=mode;projectCursor=0;
                    try{projectUpload.assign(projectSize,0);}catch(const std::bad_alloc&){break;}
                    projectDeadline=std::chrono::steady_clock::now()+std::chrono::seconds(120);continue;
                }
                if(cmd.rfind("project-get:",0)==0){
                    auto fields=cmd.substr(12);std::replace(fields.begin(),fields.end(),':',' ');std::istringstream input(fields);uint64_t id=0,revision=0;std::string trailing;
                    if(cmd.size()>80||!(input>>id>>revision)||(input>>trailing)||!id||id>UINT32_MAX||revision!=engine.project.revision.load())break;
                    download=engine.project.get();if(!download)break;downloadId=uint32_t(id);downloadCursor=0;
                    if(!sendFrame(client,1,"{\"type\":\"projectData\",\"id\":"+std::to_string(id)+",\"revision\":"+std::to_string(revision)+",\"bytes\":"+std::to_string(download->document.size())+",\"crc\":"+std::to_string(download->crc)+"}"))break;continue;
                }
                if(cmd.rfind("project-restored:",0)==0){
                    const auto number=cmd.substr(17);if(number.empty()||number.size()>10||!std::all_of(number.begin(),number.end(),[](unsigned char c){return std::isdigit(c);}))break;
                    if(std::stoull(number)==engine.project.revision.load())engine.project.recallPending.store(false);continue;
                }
                if(cmd=="arm")engine.requestArm();else if(cmd=="start")engine.requestStart();else if(cmd=="stop")engine.requestStop();else if(cmd=="hold")engine.requestHold();else if(cmd=="live")engine.requestLive();else if(cmd=="rendered")engine.requestRendered();else if(cmd=="ready")engine.browserReady.store(true);else if(cmd=="not-ready"){engine.browserReady.store(false);if(!engine.preparedMode.load())engine.requestPause();}
                else if(engine.fx&&cmd.rfind("mix:",0)==0){auto value=cmd.substr(4);if(value.empty()||value.size()>3||!std::all_of(value.begin(),value.end(),[](unsigned char c){return std::isdigit(c);}))break;const int mix=std::stoi(value);if(mix>100)break;engine.fx->mix.store(mix/100.);}
                else if(!engine.fx&&cmd.rfind("prepare:",0)==0){
                    auto fields=cmd.substr(8);std::replace(fields.begin(),fields.end(),':',' ');std::istringstream input(fields);std::string trailing;
                    uint64_t id=0,rate=0,frames=0;double beats=0,bpm=0;
                    if(cmd.size()>160||!(input>>id>>rate>>frames>>beats>>bpm)||(input>>trailing)||!id||id>UINT32_MAX||rate<8000||rate>192000||!frames||frames>maxPreparedFrames||
                       !std::isfinite(beats)||beats<1||beats>64||!std::isfinite(bpm)||bpm<1||bpm>300||std::abs(double(frames)-beats*60./bpm*rate)>2)break;
                    engine.requestPause();uploadId=uint32_t(id);uploadRate=uint32_t(rate);uploadFrames=uint32_t(frames);uploadCursor=0;uploadBeats=beats;uploadBpm=bpm;
                    try{upload.assign(size_t(frames)*2,0.f);}catch(const std::bad_alloc&){live=false;continue;}
                }
                else if(cmd.rfind("ping:",0)==0 && cmd.size()<50 && std::all_of(cmd.begin()+5,cmd.end(),[](unsigned char c){return std::isdigit(c);}))live=sendFrame(client,1,"{\"type\":\"pong\",\"id\":\""+cmd.substr(5)+"\",\"clock\":"+std::to_string(engine.clock.load())+"}");
                continue;
            }
            if(payload.size()>=16){
                uint32_t h[4]{};std::memcpy(h,payload.data(),16);
                if(h[0]==0x3153474d){
                    if(!projectId||h[1]!=projectId||h[2]!=projectCursor||h[3]==0||h[3]>32752||payload.size()!=16+size_t(h[3])||uint64_t(projectCursor)+h[3]>projectSize)break;
                    std::memcpy(projectUpload.data()+projectCursor,payload.data()+16,h[3]);projectCursor+=h[3];
                    if(projectCursor==projectSize){
                        const auto id=projectId;projectId=0;
                        jobId=id;auto previous=projectDelta?engine.project.get():nullptr;
                        projectJob=std::async(std::launch::async,[&,body=std::move(projectUpload),previous,hash=projectHash,render=projectRendered,base=projectBaseRevision,delta=projectDelta]()mutable{
                            try{if(delta){if(!previous)return false;body=expandProjectDelta(body,previous->document);}return engine.project.commit(std::move(body),hash,render,base);}catch(...){return false;}
                        });projectUpload.clear();
                    }
                    continue;
                }
            }
            if(payload.size()<24)break;
            uint32_t magic=0,epoch=0,rate=0,frames=0;double firstFrame=0;
            std::memcpy(&magic,payload.data(),4);std::memcpy(&epoch,payload.data()+4,4);std::memcpy(&rate,payload.data()+8,4);std::memcpy(&frames,payload.data()+12,4);std::memcpy(&firstFrame,payload.data()+16,8);
            if((magic!=0x3141474d&&magic!=0x324c474d&&magic!=0x3352474d)||frames==0||frames>4096||rate<8000||rate>192000||payload.size()!=24+size_t(frames)*8||!std::isfinite(firstFrame)||firstFrame<0||firstFrame>9e15||std::floor(firstFrame)!=firstFrame)break;
            if(magic==0x3352474d){
                if(!engine.fx)break;
                if(epoch!=engine.generation.load())continue;
                if(rate!=uint32_t(std::llround(engine.sampleRate.load()))||uint64_t(firstFrame)>engine.clock.load()+4096)break;
                if(packetEpoch!=epoch){packetEpoch=epoch;expectedFrame=0;}
                if(uint64_t(firstFrame)<expectedFrame)break;
                expectedFrame=uint64_t(firstFrame)+frames;
                float samples[8192]{};std::memcpy(samples,payload.data()+24,frames*8);
                for(uint32_t i=0;i<frames;++i){const float l=samples[i*2],r=samples[i*2+1];if(!engine.fx->returned.push({std::isfinite(l)?std::clamp(l,-16.f,16.f):0,std::isfinite(r)?std::clamp(r,-16.f,16.f):0,epoch,uint64_t(firstFrame)+i})){engine.overflows.fetch_add(1);live=false;break;}}
                engine.received.fetch_add(frames);continue;
            }
            if(engine.fx)break;
            if(magic==0x324c474d){
                if(!uploadId||epoch!=uploadId||rate!=uploadRate||uint64_t(firstFrame)!=uploadCursor||uploadCursor+frames>uploadFrames)break;
                std::memcpy(upload.data()+size_t(uploadCursor)*2,payload.data()+24,size_t(frames)*8);uploadCursor+=frames;
                if(uploadCursor==uploadFrames){
                    for(auto& sample:upload)sample=std::isfinite(sample)?std::clamp(sample,-16.f,16.f):0.f;
                    auto saved=std::make_shared<SavedLoop>();saved->pcm=upload;saved->rate=uploadRate;saved->beats=uploadBeats;saved->bpm=uploadBpm;
                    const bool stored=engine.prepared.publish(std::move(upload),uploadRate,uploadBeats,uploadBpm,uploadId);
                    if(stored)engine.project.rememberLoop(saved);
                    live=sendFrame(client,1,std::string("{\"type\":\"")+(stored?"loopStored":"loopRejected")+"\",\"id\":"+std::to_string(uploadId)+"}");
                    uploadId=0;upload.clear();
                }
                continue;
            }
            if(engine.preparedMode.load())continue;
            if(epoch!=engine.generation.load()||!engine.target.load())continue;
            if(packetEpoch!=epoch){packetEpoch=epoch;packetRate=rate;expectedFrame=0;}
            if(uint64_t(firstFrame)!=expectedFrame||packetRate!=rate)break;
            // Copy into aligned storage; a byte vector has no float alignment guarantee.
            std::vector<float> samples(size_t(frames)*2);std::memcpy(samples.data(),payload.data()+24,frames*8);
            engine.sourceRate.store(rate);expectedFrame+=frames;
            if(!engine.ring.push(samples.data(),frames,epoch)){engine.overflows.fetch_add(1);engine.requestStart();}
            else engine.received.fetch_add(frames);
        }
        }catch(const std::exception&){ /* Retain the committed snapshot on allocation/parse failure. */ }
        engine.browserReady.store(false);engine.connected.store(false);engine.requestPause();engine.remote.disconnect();closeSocket(client);
    }
    closeSocket(listener);boundPort.store(0);

}
}
