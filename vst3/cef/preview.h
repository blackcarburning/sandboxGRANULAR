#pragma once
// Single-producer (CEF capture), single-consumer (DAW callback), fixed storage.
// Drop on overflow, discard stale previews after a stopped/suspended host.
#include <atomic>
#include <cmath>
#include <algorithm>
#include <cstdint>
namespace mygrain::cef {
struct PreviewAudio {
 static constexpr uint32_t capacity=32768;
 std::atomic<uint32_t> write{0},read{0},rate{48000},packets{0},dropped{0};
 float pcm[capacity][2]{};
 void push(const float* const* channels,int count,int frames){
  if(!channels||count<1||frames<1)return;
  const auto w=write.load(std::memory_order_relaxed),r=read.load(std::memory_order_acquire);
  if(uint32_t(frames)>capacity-(w-r)){dropped.fetch_add(1,std::memory_order_relaxed);return;}
  for(int i=0;i<frames;++i)for(int c=0;c<2;++c){float v=channels[c<count?c:0][i];pcm[(w+i)%capacity][c]=std::isfinite(v)?v:0;}
  write.store(w+frames,std::memory_order_release);packets.fetch_add(1,std::memory_order_relaxed);
 }
};
struct PreviewReader {
 double phase=0;
 template<class T>void mix(PreviewAudio& audio,T* left,T* right,int frames,double hostRate,bool offline){
  auto r=audio.read.load(std::memory_order_relaxed);const auto w=audio.write.load(std::memory_order_acquire);
  const auto rate=audio.rate.load(std::memory_order_relaxed);
  if(offline||hostRate<8000||rate<8000){audio.read.store(w,std::memory_order_release);phase=0;return;}
  // Never replay an accumulated preview when host processing resumes.
  if(w-r>rate/8){r=w-std::min<uint32_t>(rate/50,w-r);phase=0;}
  const double ratio=double(rate)/hostRate;
  for(int i=0;i<frames;++i){
   const auto offset=uint32_t(phase);if(w-r<offset+2)break;
   const double f=phase-offset;
   for(int c=0;c<2;++c){auto* out=c?right:left;if(!out)continue;const auto a=audio.pcm[(r+offset)%PreviewAudio::capacity][c],b=audio.pcm[(r+offset+1)%PreviewAudio::capacity][c];out[i]+=T(a+(b-a)*f);}
   phase+=ratio;const auto advance=uint32_t(phase);const auto consumed=std::min(advance,w-r);r+=consumed;phase-=advance;
  }
  audio.read.store(r,std::memory_order_release);
 }
};
}
