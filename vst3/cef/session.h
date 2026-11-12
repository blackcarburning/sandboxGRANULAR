#pragma once
#include "ipc.h"
#include <filesystem>
#include <random>
#include <chrono>
#include <thread>
#ifndef _WIN32
#include <spawn.h>
#include <sys/wait.h>
#include <signal.h>
extern char** environ;
#endif
namespace mygrain::cef {
#ifdef _WIN32
inline std::wstring wide(const std::string& s){int n=MultiByteToWideChar(CP_UTF8,0,s.data(),int(s.size()),nullptr,0);std::wstring v(n,L' ');MultiByteToWideChar(CP_UTF8,0,s.data(),int(s.size()),v.data(),n);return v;}
inline std::string utf8(const std::wstring& s){int n=WideCharToMultiByte(CP_UTF8,0,s.data(),int(s.size()),nullptr,0,nullptr,nullptr);std::string v(n,' ');WideCharToMultiByte(CP_UTF8,0,s.data(),int(s.size()),v.data(),n,nullptr,nullptr);return v;}
#endif
class Session {
#ifdef _WIN32
 HANDLE process=nullptr;
#else
 pid_t process=-1;
#endif
 std::filesystem::path root;
public:
 Mapping ipc;std::atomic<PreviewAudio*> audio{nullptr};bool attempted=false;std::string error;
 ~Session(){stop();}
 bool running(){
#ifdef _WIN32
  return process&&WaitForSingleObject(process,0)==WAIT_TIMEOUT;
#else
  if(process<=0)return false;int status=0;const auto result=waitpid(process,&status,WNOHANG);if(result==process){if(std::getenv("MYGRAIN_CEF_DEBUG_PORT"))std::fprintf(stderr,"CEF_HELPER_EXIT=%d\n",status);process=-1;return false;}return result==0;
#endif
 }
 void stop(){
  audio.store(nullptr,std::memory_order_release);
  if(ipc.data)ipc.data->quit.store(1);
  const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(3);while(running()&&std::chrono::steady_clock::now()<end)std::this_thread::sleep_for(std::chrono::milliseconds(10));
#ifdef _WIN32
  if(running())TerminateProcess(process,0);if(process)CloseHandle(process);process=nullptr;
#else
  if(running()){kill(process,SIGTERM);waitpid(process,nullptr,0);}process=-1;
#endif
  ipc.close();if(!root.empty()){std::error_code ec;std::filesystem::remove_all(root,ec);root.clear();}
 }
 bool start(const std::string& executable,const std::string& url){
  if(attempted)return running();attempted=true;
  try{
   if(!std::filesystem::is_regular_file(std::filesystem::u8path(executable))){error="CEF helper is missing. Install the whole MyGrain CEF bundle.";return false;}
   std::random_device random;std::string id;for(int i=0;i<32;i++)id+="0123456789abcdef"[random()%16];
   root=std::filesystem::temp_directory_path()/std::filesystem::u8path("mygrain-cef-"+id);
   if(!std::filesystem::create_directory(root)){error="Could not create private CEF session.";return false;}
#ifndef _WIN32
   chmod(root.c_str(),0700);
#endif
   const auto file=(root/"display.ipc").u8string(),profile=(root/"profile").u8string();
   auto browserUrl=url;const auto fragment=browserUrl.find('#');browserUrl.insert(fragment==std::string::npos?browserUrl.size():fragment,browserUrl.find('?')==std::string::npos?"?mygrain_cef=1":"&mygrain_cef=1");
   if(browserUrl.size()>=sizeof(Shared::url)||!ipc.open(file,true)){error="Could not create CEF display transport.";return false;}
   std::memcpy(ipc.data->url,browserUrl.c_str(),browserUrl.size()+1);
   audio.store(&ipc.data->preview,std::memory_order_release);
#ifdef _WIN32
   const auto exe=wide(executable);auto args=L"\""+exe+L"\" \""+wide(file)+L"\" "+std::to_wstring(GetCurrentProcessId())+L" \""+wide(profile)+L"\"";
   wchar_t debug[16]{};if(GetEnvironmentVariableW(L"MYGRAIN_CEF_DEBUG_PORT",debug,16)){const int port=_wtoi(debug);if(port>=1024&&port<=65535)args+=L" "+std::to_wstring(port);}
   STARTUPINFOW start{};start.cb=sizeof(start);PROCESS_INFORMATION child{};
   if(!CreateProcessW(exe.c_str(),args.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&start,&child)){error="CEF helper could not start ("+std::to_string(GetLastError())+").";return false;}
   process=child.hProcess;CloseHandle(child.hThread);
#else
   auto parent=std::to_string(getpid());std::string debug;const char* value=std::getenv("MYGRAIN_CEF_DEBUG_PORT");if(value){int port=std::atoi(value);if(port>=1024&&port<=65535)debug=std::to_string(port);}
   char* args[]{const_cast<char*>(executable.c_str()),const_cast<char*>(file.c_str()),parent.data(),const_cast<char*>(profile.c_str()),debug.empty()?nullptr:debug.data(),nullptr};
   if(posix_spawn(&process,executable.c_str(),nullptr,nullptr,args,environ)!=0){process=-1;error="CEF helper could not start.";return false;}
#endif
   return true;
  }catch(const std::exception&){error="Could not initialize the private CEF session.";return false;}
 }
 void resize(uint32_t w,uint32_t h){if(ipc.data){ipc.data->width.store(std::clamp(w,320u,maxWidth));ipc.data->height.store(std::clamp(h,200u,maxHeight));}}
 void visible(bool value){if(ipc.data)ipc.data->shown.store(value);}
};
}
