#pragma once
// Persist only MYGRAIN's host-only HttpOnly session, never a password or project.
// Every helper still owns a separate Chromium profile and application state.
struct RememberedLogin {
 std::string token;double expires=0;
 bool operator==(const RememberedLogin& other)const{return token==other.token&&expires==other.expires;}
 static std::filesystem::path path(){
  if(const char* overridePath=std::getenv("MYGRAIN_CEF_LOGIN_PATH"))return std::filesystem::u8path(overridePath); // isolated native checks
#ifdef _WIN32
  PWSTR folder=nullptr;if(FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData,0,nullptr,&folder)))return {};
  auto value=std::filesystem::path(folder)/L"MyGrain CEF"/L"login.dat";CoTaskMemFree(folder);return value;
#elif defined(__APPLE__)
  const char* home=std::getenv("HOME");return home?std::filesystem::path(home)/"Library/Application Support/MyGrain CEF/login.dat":std::filesystem::path{};
#else
  const char* home=std::getenv("HOME");return home?std::filesystem::path(home)/".local/share/mygrain-cef/login.dat":std::filesystem::path{};
#endif
 }
 bool valid()const{return token.size()>=16&&token.size()<=256&&token.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")==std::string::npos&&expires>std::chrono::duration<double>(std::chrono::system_clock::now().time_since_epoch()).count();}
 static RememberedLogin read(){
  try{auto p=path();if(p.empty()||!std::filesystem::is_regular_file(p)||std::filesystem::file_size(p)>8192)return {};
   std::ifstream f(p,std::ios::binary);std::string bytes((std::istreambuf_iterator<char>(f)),{});
#ifdef _WIN32
   DATA_BLOB input{DWORD(bytes.size()),(BYTE*)bytes.data()},output{};if(!CryptUnprotectData(&input,nullptr,nullptr,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&output))return {};
   bytes.assign((char*)output.pbData,output.cbData);SecureZeroMemory(output.pbData,output.cbData);LocalFree(output.pbData);
#endif
   RememberedLogin result;std::istringstream s(bytes);s>>result.expires>>result.token;return result.valid()?result:RememberedLogin{};
  }catch(...){return {};}
 }
 bool save()const{
  try{auto p=path();if(p.empty())return false;
   if(token.empty()){std::error_code e;std::filesystem::remove(p,e);return !e;}
   if(!valid())return false;
   std::filesystem::create_directories(p.parent_path());
#ifndef _WIN32
   chmod(p.parent_path().c_str(),0700);
#endif
   std::ostringstream s;s<<std::fixed<<std::setprecision(0)<<expires<<'\n'<<token<<'\n';std::string bytes=s.str();
#ifdef _WIN32
   DATA_BLOB input{DWORD(bytes.size()),(BYTE*)bytes.data()},output{};if(!CryptProtectData(&input,L"MyGrain CEF login",nullptr,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&output))return false;
   bytes.assign((char*)output.pbData,output.cbData);LocalFree(output.pbData);
#endif
   auto temp=p;temp+=std::string(".tmp-")+std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
#ifdef _WIN32
   {std::ofstream f(temp,std::ios::binary);f.write(bytes.data(),bytes.size());f.close();if(!f)return false;}
   if(!MoveFileExW(temp.c_str(),p.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)){std::filesystem::remove(temp);return false;}
#else
   int fd=::open(temp.c_str(),O_WRONLY|O_CREAT|O_EXCL,0600);if(fd<0)return false;
   const auto written=::write(fd,bytes.data(),bytes.size());::close(fd);if(written!=ssize_t(bytes.size())){std::filesystem::remove(temp);return false;}std::filesystem::rename(temp,p);
#endif
   return true;
  }catch(...){return false;}
 }
};
RememberedLogin lastLogin;
bool loginVisitPending=false,loginImported=false;
// Cookie callbacks run on CEF's UI thread, including the empty-visit release.
struct LoginVisitor {
 cef_cookie_visitor_t api{};std::atomic<int> refs{1};RememberedLogin found;
 LoginVisitor(){api.base.size=sizeof(api);api.base.add_ref=[](cef_base_ref_counted_t* b){++((LoginVisitor*)b)->refs;};api.base.release=[](cef_base_ref_counted_t* b)->int{auto* self=(LoginVisitor*)b;if(--self->refs==1&&loginVisitPending){self->complete();}return 0;};api.base.has_one_ref=[](cef_base_ref_counted_t* b)->int{return ((LoginVisitor*)b)->refs==1;};api.base.has_at_least_one_ref=[](cef_base_ref_counted_t* b)->int{return ((LoginVisitor*)b)->refs>0;};
  api.visit=[](cef_cookie_visitor_t* visitor,const cef_cookie_t* cookie,int,int,int*)->int{
   if(utf8(&cookie->name)=="mygrain_session"&&utf8(&cookie->domain)=="openclaw.blackcarburning.com"&&utf8(&cookie->path)=="/"&&cookie->httponly&&cookie->secure&&cookie->has_expires){auto* self=(LoginVisitor*)visitor;self->found={utf8(&cookie->value),cookie->expires.val/1000000.0-11644473600.0};}return 1;
  };
 }
 void complete(){if(!(found==lastLogin)&&found.save())lastLogin=found;loginVisitPending=false;}
};
LoginVisitor loginVisitor; // Static callback storage outlives every asynchronous CEF request.
void rememberLogin(cef_cookie_manager_t* manager){if(!manager||!loginImported||loginVisitPending)return;loginVisitPending=true;loginVisitor.found={};loginVisitor.api.base.add_ref(&loginVisitor.api.base);String url("https://openclaw.blackcarburning.com/");if(!manager->visit_url_cookies(manager,url,1,&loginVisitor.api))loginVisitPending=false;}
