#include "core.h"
#include <cassert>
#include <iostream>
#include <limits>
using namespace mygrain;
int main(){
    AudioRing ring;float samples[]{1,-1,std::numeric_limits<float>::quiet_NaN(),2};assert(ring.push(samples,2,7));assert(ring.size()==2);assert(ring.at(0).epoch==7);assert(ring.at(1).l==0);ring.consume(1);assert(ring.at(0).r==2);ring.clear();assert(ring.size()==0);
    std::vector<float> full(capacity*2,0.125f);assert(ring.push(full.data(),capacity,9));assert(!ring.push(full.data(),1,9));ring.consume(capacity-4);assert(ring.push(full.data(),128,10));assert(ring.at(3).epoch==9&&ring.at(4).epoch==10);ring.clear();
    Engine e;HostBlock h;h.playing=true;h.musicalValid=true;h.timingValid=true;
    e.connected=true;e.browserReady=true;e.requestStart();float l[128]{},r[128]{};e.process(l,r,128,h);
    assert(e.target.load()==96000);assert(e.generation.load()==2);assert(!e.running.load());
    std::vector<float> pcm(48000*2,0.25f);assert(e.ring.push(pcm.data(),48000,e.generation));
    while(e.clock.load()<96000){h.projectSample=e.clock;h.ppq=h.projectSample*120./(60*48000);e.process(l,r,128,h);}
    h.projectSample=e.clock;h.ppq=4;e.process(l,r,128,h);assert(e.running);assert(l[127]>0.2f);assert(std::abs(l[127]-r[127])<1e-6);
    e.connected=false;h.projectSample=e.clock;e.process(l,r,128,h);for(auto v:l)assert(v==0);assert(!e.target);assert(!e.running);
    // Live ignores timeline seeks, including while waiting for its first start.
    e.connected=true;e.browserReady=true;e.requestStart();h.projectSample=e.clock;h.ppq=8;e.process(l,r,128,h);auto generation=e.generation.load();auto start=e.target.load();h.projectSample=0;h.ppq=0;e.process(l,r,128,h);assert(e.generation==generation);assert(e.target==start);assert(e.ring.size()==0);
    // No stale queue during offline export; disconnection remains silent.
    h.offline=true;h.projectSample=128;e.process(l,r,128,h);assert(!e.target);for(auto v:l)assert(v==0);
    // A slow producer must re-arm, never replay old late audio at the wrong time.
    Engine slow;slow.connected=true;slow.browserReady=true;slow.requestStart();h=HostBlock{};slow.process(l,r,128,h);auto target=slow.target.load();assert(target==48000);while(slow.clock<target)slow.process(l,r,128,h);slow.process(l,r,128,h);assert(slow.underflows>0);assert(slow.generation>=3);
    // Resampling 44.1 -> 48 kHz has the expected consumption ratio.
    Engine res;res.connected=true;res.browserReady=true;res.sourceRate=44100;res.requestStart();h=HostBlock{};res.process(l,r,128,h);assert(res.ring.push(pcm.data(),48000,res.generation));
    while(res.clock<res.target)res.process(l,r,128,h);auto before=res.ring.size();for(int i=0;i<375;++i)res.process(l,r,128,h);auto consumed=before-res.ring.size();assert(consumed>43900&&consumed<44300);
    // Green Arm cancels orange Play audition while stopped, without disarming.
    Engine audition;audition.connected=true;audition.browserReady=true;h=HostBlock{};audition.requestStart();audition.process(l,r,128,h);assert(audition.target>0);
    audition.requestArm();audition.process(l,r,128,h);assert(audition.armed);assert(audition.target==0);assert(!audition.running);for(auto value:l)assert(value==0);
    // Arm is user intent, not a processor-running flag.
    Engine latch;latch.connected=true;latch.browserReady=true;h=HostBlock{};h.playing=true;h.musicalValid=true;latch.requestArm();latch.process(l,r,128,h);assert(latch.armed&&latch.target>0);
    latch.requestPause();latch.process(l,r,128,h);assert(latch.armed&&latch.target>0);
    h.offline=true;latch.process(l,r,128,h);assert(latch.armed&&latch.target==0);
    h.offline=false;latch.process(l,r,128,h);assert(latch.armed&&latch.target>0);
    latch.browserReady=false;latch.requestPause();latch.process(l,r,128,h);assert(latch.armed&&latch.target==0);
    latch.browserReady=true;latch.process(l,r,128,h);assert(latch.armed&&latch.target>0);
    latch.connected=false;latch.process(l,r,128,h);assert(latch.armed&&latch.target==0);for(auto x:l)assert(x==0);
    latch.connected=true;latch.process(l,r,128,h);assert(latch.armed&&latch.target>0);
    latch.requestRendered();latch.process(l,r,128,h);assert(latch.armed&&!latch.preparedMode&&latch.target==0); // Await first snapshot, not accidental Live.
    latch.requestLive();latch.process(l,r,128,h);assert(latch.armed&&latch.target>0);
    latch.requestStop();latch.process(l,r,128,h);assert(!latch.armed&&latch.target==0);latch.requestPause();latch.requestRendered();latch.process(l,r,128,h);latch.requestLive();latch.process(l,r,128,h);assert(!latch.armed&&latch.target==0);
    std::cout<<"PASS bounded ring, finite audio, exact target, stop, continuous seek, offline, underrun recovery, resampling\n";
}
