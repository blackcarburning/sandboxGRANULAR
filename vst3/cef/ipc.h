#pragma once
// Private per-instance display/input transport. Never used by the audio callback.
// CEF owns its own process and main loop, not the DAW's application singleton.
#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>
#include <algorithm>
#include <vector>
#include <new>
#ifdef _WIN32
#include <windows.h>
#else
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#endif
namespace mygrain::cef {
constexpr uint32_t magic=0x3146434d, maxWidth=2048,maxHeight=1600,queueSize=512;
constexpr size_t frameBytes=size_t(maxWidth)*maxHeight*4;
enum EventType : uint32_t {Move=1,Down,Up,Wheel,KeyDown,KeyUp,Char,Focus,Reload,Store};
// Modifiers use the stable CEF EVENTFLAG_* values.
struct Event {uint32_t type=0;int32_t x=0,y=0,a=0,b=0;uint32_t modifiers=0;};
struct Shared {
 uint32_t signature=magic,version=1;
 std::atomic<uint32_t> quit{0},width{1240},height{756},shown{1},status{0};
 char url[1024]{};
 std::atomic<uint32_t> painting{0};
 std::atomic<uint32_t> frame{0},published{0},reading{3};
 uint32_t frameWidth[3]{},frameHeight[3]{};
 std::atomic<uint32_t> write{0},read{0};Event events[queueSize]{};
 uint8_t pixels[3][frameBytes];
};
static_assert(std::atomic<uint32_t>::is_always_lock_free,"IPC requires lock-free uint32");
class Mapping {
#ifdef _WIN32
 HANDLE file=INVALID_HANDLE_VALUE,mapping=nullptr;
#else
 int fd=-1;
#endif
 bool creator=false;std::string path;
public:
 Shared* data=nullptr;
 ~Mapping(){close();}
 bool open(const std::string& name,bool create){
  if(data)return false;creator=create;path=name;
#ifdef _WIN32
  int n=MultiByteToWideChar(CP_UTF8,0,name.c_str(),-1,nullptr,0);std::wstring wide(n,L'\0');MultiByteToWideChar(CP_UTF8,0,name.c_str(),-1,wide.data(),n);
  file=CreateFileW(wide.c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,create?CREATE_NEW:OPEN_EXISTING,FILE_ATTRIBUTE_TEMPORARY,nullptr);
  if(file==INVALID_HANDLE_VALUE)return false;
  LARGE_INTEGER bytes;bytes.QuadPart=sizeof(Shared);
  if(create){SetFilePointerEx(file,bytes,nullptr,FILE_BEGIN);if(!SetEndOfFile(file))return false;}
  else {LARGE_INTEGER size{};if(!GetFileSizeEx(file,&size)||size.QuadPart!=bytes.QuadPart)return false;}
  mapping=CreateFileMappingW(file,nullptr,PAGE_READWRITE,0,0,nullptr);if(!mapping)return false;
  data=(Shared*)MapViewOfFile(mapping,FILE_MAP_ALL_ACCESS,0,0,sizeof(Shared));
#else
  fd=::open(name.c_str(),O_RDWR|(create?(O_CREAT|O_EXCL):0),0600);if(fd<0)return false;
  if(create&&ftruncate(fd,sizeof(Shared))!=0)return false;
  struct stat st{};if(fstat(fd,&st)||st.st_size!=off_t(sizeof(Shared)))return false;
  auto* p=mmap(nullptr,sizeof(Shared),PROT_READ|PROT_WRITE,MAP_SHARED,fd,0);if(p==MAP_FAILED)return false;data=(Shared*)p;
#endif
  if(create&&data)new(data)Shared;
  return data&&data->signature==magic&&data->version==1;
 }
 void close(){
#ifdef _WIN32
  if(data)UnmapViewOfFile(data);if(mapping)CloseHandle(mapping);if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);
  mapping=nullptr;file=INVALID_HANDLE_VALUE;
  if(creator&&!path.empty()){int n=MultiByteToWideChar(CP_UTF8,0,path.c_str(),-1,nullptr,0);std::wstring w(n,L'\0');MultiByteToWideChar(CP_UTF8,0,path.c_str(),-1,w.data(),n);DeleteFileW(w.c_str());}
#else
  if(data)munmap(data,sizeof(Shared));if(fd>=0)::close(fd);fd=-1;if(creator&&!path.empty())unlink(path.c_str());
#endif
  data=nullptr;creator=false;
 }
 bool push(Event e){if(!data)return false;const auto w=data->write.load(std::memory_order_relaxed);if(w-data->read.load(std::memory_order_acquire)>=queueSize)return false;data->events[w%queueSize]=e;data->write.store(w+1,std::memory_order_release);return true;}
 bool pop(Event& e){const auto r=data->read.load(std::memory_order_relaxed);if(r==data->write.load(std::memory_order_acquire))return false;e=data->events[r%queueSize];data->read.store(r+1,std::memory_order_release);return true;}
 void paint(const void* pixels,uint32_t w,uint32_t h){
  if(!data||!w||!h||w>maxWidth||h>maxHeight)return;
  uint32_t unlocked=0;if(!data->painting.compare_exchange_strong(unlocked,1,std::memory_order_acquire))return;
  const auto published=data->published.load(std::memory_order_acquire),reading=data->reading.load(std::memory_order_acquire);
  uint32_t slot=0;while(slot==published||slot==reading)++slot;
  std::memcpy(data->pixels[slot],pixels,size_t(w)*h*4);data->frameWidth[slot]=w;data->frameHeight[slot]=h;
  data->published.store(slot,std::memory_order_release);data->frame.fetch_add(1,std::memory_order_release);data->painting.store(0,std::memory_order_release);
 }
 bool copy(std::vector<uint8_t>& pixels,uint32_t& w,uint32_t& h){
  if(!data||!data->frame.load(std::memory_order_acquire))return false;
  uint32_t unlocked=0;if(!data->painting.compare_exchange_strong(unlocked,1,std::memory_order_acquire))return false;
  uint32_t slot;
  // Reader advertises its slot, then checks that the writer has not moved on.
  do{slot=data->published.load(std::memory_order_acquire);data->reading.store(slot,std::memory_order_seq_cst);}while(slot!=data->published.load(std::memory_order_seq_cst));
  w=data->frameWidth[slot];h=data->frameHeight[slot];
  bool valid=w&&h&&w<=maxWidth&&h<=maxHeight;
  if(valid){pixels.resize(size_t(w)*h*4);std::memcpy(pixels.data(),data->pixels[slot],pixels.size());}
  data->reading.store(3,std::memory_order_release);data->painting.store(0,std::memory_order_release);return valid;
 }
};
}
