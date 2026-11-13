#include "core.h"
#include <cassert>
#include <iostream>
#include <thread>
#include <atomic>
#include <cstdlib>
#include <new>
using namespace mygrain;
static std::atomic<bool> audit{false};
static std::atomic<unsigned> allocations{0},deletions{0};
void* operator new(std::size_t n){if(audit)allocations++;if(void* p=std::malloc(n))return p;throw std::bad_alloc();}
void operator delete(void* p) noexcept {if(audit)deletions++;std::free(p);}
void operator delete(void* p,std::size_t) noexcept {if(audit)deletions++;std::free(p);}
template<class Sample> void block(Engine& e,Sample* l,Sample* r,int n,const HostBlock& h){audit=true;e.process(l,r,n,h);audit=false;assert(allocations==0&&deletions==0);}
int main(){
 float l[128]{},r[128]{};HostBlock h;h.playing=true;h.musicalValid=true;h.timingValid=true;h.cycleActive=true;h.cycleValid=true;h.cycleEnd=4;
 // A real cycle wrap must not discard the live queue or assign a new epoch.
 Engine live;live.connected=true;live.browserReady=true;live.requestArm();block(live,l,r,128,h);const auto generation=live.generation.load();const auto target=live.target.load();
 std::vector<float> feed(48000*2,.25f);assert(live.ring.push(feed.data(),48000,generation));
 for(int i=1;i<3750;++i){
  auto frame=live.clock.load();h.projectSample=frame%96000;h.ppq=h.projectSample/24000.;
  if(frame>=target)assert(live.ring.push(feed.data(),128,generation));
  // The second half deliberately supplies NO valid cycle endpoints or flag.
  if(i>1875){h.cycleActive=false;h.cycleValid=false;}
  block(live,l,r,128,h);assert(live.generation==generation);
  if(frame>=target+256)for(auto sample:l)assert(sample>.2f);
 }
 assert(live.cycleWraps>=2&&live.timelineJumps>=4&&live.underflows==0);
 // Arbitrary backward/forward seeks in Live are also continuous.
 h.projectSample=12345;h.ppq=h.projectSample/24000.;block(live,l,r,128,h);assert(live.generation==generation&&live.target==target);for(auto x:l)assert(x>.2f);
 h.projectSample=1234567;h.ppq=h.projectSample/24000.;block(live,l,r,128,h);assert(live.generation==generation);for(auto x:l)assert(x>.2f);
 // Prepared stereo audio is available at the FIRST sample at timeline zero.
 Engine e;e.connected=true;e.browserReady=true;h=HostBlock{};h.musicalValid=true;h.timingValid=true;
 std::vector<float> pcm(88200*2);
 for(size_t i=0;i<88200;++i){pcm[i*2]=.1f+float(i%441)/1000;pcm[i*2+1]=-.2f-float(i%147)/1000;}
 assert(e.prepared.publish(std::move(pcm),44100,4,120,1));e.requestArm();block(e,l,r,128,h);assert(e.preparedMode&&e.preparedRevision==1);for(float x:l)assert(x==0);
 h.playing=true;h.projectSample=0;h.ppq=0;block(e,l,r,128,h);assert(e.running);assert(std::abs(l[0]-.1f)<1e-7&&std::abs(r[0]+.2f)<1e-7);assert(e.target==0&&e.underflows==0);
 // Loop length need not equal the prepared pattern. A boundary inside a block
 // and a nonzero loop start follow host position, with NO mute/fade or re-arm.
 h.cycleActive=true;h.cycleValid=true;h.cycleStart=1;h.cycleEnd=3;
 for(int pass=0;pass<4;++pass){
  h.ppq=3-64./24000;h.projectSample=int64_t(h.ppq*24000);block(e,l,r,128,h);
  assert(std::abs(l[64]-.1f)<1e-5); // beat 1 -> source frame 22050 -> index mod 441 = 0.
  for(auto x:l)assert(x>=.099f);assert(e.running&&e.underflows==0);
  h.ppq=1+64./24000;h.projectSample=int64_t(h.ppq*24000);block(e,l,r,128,h);for(auto x:l)assert(x>=.099f);
 }
 // Seeks and tempo changes read the new timeline position immediately.
 h.ppq=2;h.tempo=90;h.projectSample=64000;double dl[128]{},dr[128]{};block(e,dl,dr,128,h);assert(std::abs(dl[0]-.1)<1e-6&&std::abs(dr[0]+.2)<1e-6);
 h.playing=false;block(e,l,r,128,h);for(float x:l)assert(x==0);assert(!e.running);
 h.playing=true;h.ppq=0;h.projectSample=0;block(e,l,r,128,h);assert(std::abs(l[0]-.1f)<1e-7);
 // Offline callbacks need neither browser time nor new packets.
 h.offline=true;for(int i=0;i<2000;++i){h.ppq=i*128*90./(60*48000);h.projectSample=i*128;block(e,l,r,128,h);for(float x:l)assert(x>=.099f);}
 assert(e.underflows==0&&e.preparedRevision==1);
 // A stopped/suspended host may adopt the upload only on its FIRST playing
 // callback: it must still output frame zero, without browser pre-roll.
 Engine suspended;suspended.connected=true;suspended.browserReady=true;suspended.active=false;
 std::vector<float> primed(96000*2,.375f);assert(suspended.prepared.publish(std::move(primed),48000,4,120,9));suspended.requestArm();HostBlock first;first.playing=true;first.musicalValid=true;block(suspended,l,r,128,first);assert(l[0]==.375f&&suspended.running);
 suspended.command=5;block(suspended,l,r,128,first);assert(l[0]==.375f&&suspended.armed);
 // Publication and replacement never allocate or destroy audio on the RT thread.
 std::vector<float> replacement(96000*2,.5f);assert(e.prepared.publish(std::move(replacement),48000,4,120,2));block(e,l,r,128,h);assert(e.preparedRevision==2&&l[0]==.5f);
 e.requestStop();block(e,l,r,128,h);for(float x:l)assert(x==0);
 e.requestLive();block(e,l,r,128,h);assert(!e.preparedMode);for(float x:l)assert(x==0);
 // Switching to the retained rendered snapshot does not render or upload again.
 e.requestRendered();block(e,l,r,128,h);assert(e.preparedMode&&e.preparedRevision==2&&!e.armed);for(float x:l)assert(x==0);
 e.requestArm();h.playing=true;h.ppq=0;block(e,l,r,128,h);assert(l[0]==.5f&&e.running);
 e.requestLive();block(e,l,r,128,h);assert(!e.preparedMode&&e.armed);
 Engine empty;empty.connected=true;empty.browserReady=true;empty.requestRendered();block(empty,l,r,128,h);assert(!empty.preparedMode&&!empty.armed);
 // Stress immutable slot ownership while writer reallocates/reuses old slots.
 PreparedBank bank;std::atomic<bool> finished{false};std::atomic<int> accepted{0};
 std::thread producer([&]{for(uint32_t i=1;i<=5000;++i){std::vector<float> data(256*2,float(i));while(!bank.publish(std::move(data),48000,4,120,i))std::this_thread::yield();accepted++;}finished=true;});
 int adopted=0;while(!finished||adopted<accepted){if(bank.adopt())adopted++;if(bank.valid()){float a,b;bank.sample(.134,a,b);assert(a==b&&a==float(bank.revision()));}else std::this_thread::yield();}
 producer.join();assert(adopted==5000);
 std::cout<<"PASS live continuity with/without cycle metadata, continuous seeks, retained rendered selection, prepared first sample, nonzero/in-block cycles, seek/tempo, stop/resume, offline, RT allocation guard, 5000 concurrent slot replacements\n";
}
