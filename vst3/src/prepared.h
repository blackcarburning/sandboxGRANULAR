#pragma once
#include <atomic>
#include <array>
#include <vector>
#include <cstdint>
#include <cmath>
#include <algorithm>

namespace mygrain {
constexpr uint32_t maxPreparedFrames=4u*1024*1024; // 32 MiB stereo float32.
// Socket thread owns writing/allocation; audio thread only adopts immutable
// slots and releases the prior slot. No shared_ptr locks or deletion in process.
class PreparedBank {
    enum { Free, Writing, Ready, Reading };
    struct Slot {
        std::atomic<int> state{Free};
        std::vector<float> pcm;
        uint32_t rate=0, revision=0;
        double beats=0, bpm=120;
    };
    std::array<Slot,3> slots;
    std::atomic<int> pending{-1};
    int current=-1; // Audio thread only.
public:
    bool hasPending() const {return pending.load(std::memory_order_acquire)>=0;}
    bool publish(std::vector<float>&& pcm,uint32_t rate,double beats,double bpm,uint32_t revision) {
        if(pcm.empty()||pcm.size()%2||pcm.size()/2>maxPreparedFrames||rate<8000||rate>192000||
           !std::isfinite(beats)||beats<=0||!std::isfinite(bpm)||bpm<1||bpm>300||!revision)return false;
        // Only one pending publication. Never overwrite a slot the audio thread
        // may have taken between the pending exchange and its Reading store.
        if(pending.load(std::memory_order_acquire)!=-1)return false;
        for(int i=0;i<3;++i){
            int expected=Free;
            if(!slots[i].state.compare_exchange_strong(expected,Writing,std::memory_order_acq_rel))continue;
            auto& s=slots[i];s.pcm=std::move(pcm);s.rate=rate;s.beats=beats;s.bpm=bpm;s.revision=revision;
            s.state.store(Ready,std::memory_order_release);pending.store(i,std::memory_order_release);return true;
        }
        return false;
    }
    bool adopt() {
        const int next=pending.exchange(-1,std::memory_order_acq_rel);
        if(next<0)return false;
        const int old=current;current=next;slots[next].state.store(Reading,std::memory_order_release);
        if(old>=0)slots[old].state.store(Free,std::memory_order_release);
        return true;
    }
    bool valid() const {return current>=0;}
    uint32_t revision() const {return valid()?slots[current].revision:0;}
    uint32_t frames() const {return valid()?uint32_t(slots[current].pcm.size()/2):0;}
    double beats() const {return valid()?slots[current].beats:0;}
    double bpm() const {return valid()?slots[current].bpm:120;}
    // Position is DAW quarter notes from timeline zero, not a browser clock.
    void sample(double beat,float& l,float& r) const {
        const auto& s=slots[current];const auto n=s.pcm.size()/2;
        double phase=std::fmod(beat,s.beats);if(phase<0)phase+=s.beats;
        const double position=phase/s.beats*n;const auto a=size_t(position)%n,b=(a+1)%n;
        const double f=position-std::floor(position);
        l=float(s.pcm[a*2]+(s.pcm[b*2]-s.pcm[a*2])*f);
        r=float(s.pcm[a*2+1]+(s.pcm[b*2+1]-s.pcm[a*2+1])*f);
    }
};
}
