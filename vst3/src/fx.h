#pragma once
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace mygrain {
constexpr uint32_t fxCapacity=1u<<18;
struct FxFrame {float l=0,r=0;uint32_t epoch=0;uint64_t frame=0;};
// Bounded SPSC in either direction. Only that ring's consumer discards frames.
class FxRing {
    std::vector<FxFrame> data=std::vector<FxFrame>(fxCapacity);
    alignas(64) std::atomic<uint64_t> written{0},read{0};
public:
    uint64_t size() const{return written.load(std::memory_order_acquire)-read.load(std::memory_order_acquire);}
    FxFrame front() const{return data[read.load(std::memory_order_relaxed)&(fxCapacity-1)];}
    bool push(const FxFrame& value){const auto w=written.load(std::memory_order_relaxed);if(w-read.load(std::memory_order_acquire)>=fxCapacity)return false;data[w&(fxCapacity-1)]=value;written.store(w+1,std::memory_order_release);return true;}
    void pop(){read.fetch_add(1,std::memory_order_release);}
    void clear(){read.store(written.load(std::memory_order_acquire),std::memory_order_release);}
};
class FxTransport {
    struct Dry {float l=0,r=0;};
    std::vector<Dry> delay=std::vector<Dry>(192001);
    uint64_t dryCursor=0,validDry=0;
    double wetEnvelope=0;
    bool wasAvailable=false;
public:
    FxRing input,returned;
    std::atomic<float> inputLeft{0},inputRight{0};
    std::atomic<double> mix{1};
    std::atomic<bool> bypass{false};
    std::atomic<uint64_t> late{0},inputDrops{0},missing{0};
    uint32_t latency(double rate) const{return uint32_t(std::llround(rate));}
    void lifecycleReset(){validDry=0;dryCursor=0;wetEnvelope=0;wasAvailable=false;returned.clear();}
    template<class Sample> bool process(Sample* l,Sample* r,const Sample* il,const Sample* ir,int frames,double rate,uint64_t now,
        bool available,uint32_t cmd,std::atomic<uint32_t>& generation){
        if(available!=wasAvailable||cmd==1||cmd==2||cmd==3||cmd==5||cmd==7){generation.fetch_add(1);returned.clear();wetEnvelope=0;}
        wasAvailable=available;
        const auto epoch=generation.load();const uint32_t n=latency(rate);float pl=0,pr=0;bool anyWet=false,miss=false;
        const double wantedMix=std::clamp(mix.load(),0.,1.),step=1./std::max(1.,rate*.005);
        for(int i=0;i<frames;++i){
            float a=il&&std::isfinite(il[i])?float(std::clamp(double(il[i]),-16.,16.)):0;
            float b=ir&&std::isfinite(ir[i])?float(std::clamp(double(ir[i]),-16.,16.)):0;
            pl=std::max(pl,std::abs(a));pr=std::max(pr,std::abs(b));
            const auto slot=dryCursor%n;const auto old=delay[slot];delay[slot]={a,b};dryCursor++;
            const bool hasDry=validDry++>=n;const float dl=hasDry?old.l:0,dr=hasDry?old.r:0;
            if(available&&!input.push({a,b,epoch,now+uint64_t(i)}))inputDrops.fetch_add(1,std::memory_order_relaxed);
            const auto outputFrame=now+uint64_t(i);bool found=false;float wl=0,wr=0;
            while(returned.size()){
                const auto next=returned.front();
                if(next.epoch!=epoch||next.frame+n<outputFrame){returned.pop();late.fetch_add(1,std::memory_order_relaxed);continue;}
                if(next.frame+n==outputFrame){wl=next.l;wr=next.r;found=true;returned.pop();}break;
            }
            const bool use=available&&found&&!bypass.load(std::memory_order_relaxed);
            wetEnvelope=std::clamp(wetEnvelope+(use?step:-step),0.,1.);
            // A missing return never repeats stale audio. The aligned dry signal
            // takes over; no undelayed fallback or unbounded queue correction.
            if(!found){wl=dl;wr=dr;if(available&&hasDry)miss=true;}
            const double wet=wetEnvelope*wantedMix;
            if(l)l[i]=Sample(dl*(1-wet)+wl*wet);
            if(r)r[i]=Sample(dr*(1-wet)+wr*wet);
            anyWet|=use;
        }
        inputLeft.store(pl,std::memory_order_relaxed);inputRight.store(pr,std::memory_order_relaxed);
        if(miss)missing.fetch_add(1,std::memory_order_relaxed);
        return anyWet;
    }
};
}
