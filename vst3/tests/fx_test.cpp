#include "core.h"
#include <cassert>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <new>
static bool inProcess=false;
void* operator new(std::size_t n){assert(!inProcess);if(auto p=std::malloc(n))return p;throw std::bad_alloc();}
void operator delete(void* p) noexcept{assert(!inProcess);std::free(p);}
void operator delete(void* p,std::size_t) noexcept{assert(!inProcess);std::free(p);}
template<class Sample> void check(double rate){
    mygrain::Engine e(true);mygrain::HostBlock h;h.rate=rate;h.playing=false;
    e.connected=true;e.browserReady=true;e.requestArm();
    Sample il[128]{},ir[128]{},l[128]{},r[128]{};
    const auto latency=e.fx->latency(rate);assert(latency==uint32_t(rate));
    uint64_t now=0;const auto pulse=uint64_t(512);bool observed=false;
    for(int block=0;now<latency+4096;block++){
        for(int i=0;i<128;i++){il[i]=now+i==pulse?Sample(.25):0;ir[i]=now+i==pulse?Sample(-.125):0;}
        inProcess=true;e.process(l,r,128,h,il,ir);inProcess=false;
        // Simulated browser processing, outside the guarded audio callback:
        // identity stereo at exact input sample positions with a 128-frame trip.
        while(e.fx->input.size()){auto f=e.fx->input.front();e.fx->input.pop();assert(e.fx->returned.push(f));}
        for(int i=0;i<128;i++){assert(std::isfinite(l[i])&&std::isfinite(r[i]));if(now+i==pulse+latency){assert(std::abs(l[i]-.25)<1e-6);assert(std::abs(r[i]+.125)<1e-6);observed=true;}else assert(l[i]==0&&r[i]==0);}
        now+=128;
    }
    assert(observed);assert(e.armed);assert(e.running);assert(e.fx->late==0);
    // Disarm/reconnect/host pause never clears intent unless Stop was explicit.
    e.requestPause();e.process(l,r,128,h,il,ir);assert(e.armed);
    e.requestStop();e.process(l,r,128,h,il,ir);assert(!e.armed);
    e.requestArm();h.offline=true;e.process(l,r,128,h,il,ir);assert(e.armed&&!e.running);
    // All fallbacks retain exactly the same delay, including native bypass.
    e.fx->lifecycleReset();e.fx->bypass=true;h.offline=false;
    for(uint64_t f=0;f<latency+512;f+=128){for(int i=0;i<128;i++)il[i]=f+i==128?Sample(.4):0;
        inProcess=true;e.process(l,r,128,h,il,ir);inProcess=false;
        for(int i=0;i<128;i++)assert(std::abs(l[i]-((f+i==latency+128)?Sample(.4):0))<1e-6);
    }
    il[0]=std::numeric_limits<Sample>::quiet_NaN();ir[0]=std::numeric_limits<Sample>::infinity();e.process(l,r,128,h,il,ir);for(auto v:l)assert(std::isfinite(v));
}
int main(){check<float>(44100);check<float>(48000);check<double>(96000);check<float>(192000);std::cout<<"PASS FX: exact impulse/dry/wet latency at 44.1/48/96/192k, stereo, float/double, bypass, offline, Arm, finite PCM; zero callback allocations/deletions\n";}
