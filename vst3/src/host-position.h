#pragma once
#include <atomic>
#include <cstdint>

namespace mygrain {
struct HostPosition {
    uint64_t frame=0;
    double rate=48000,tempo=120,ppq=0,cycleStart=0,cycleEnd=0;
    bool musical=false,cycleActive=false;
};
// One realtime writer, socket-thread readers. The audio thread never waits,
// allocates or locks. Atomic fields avoid C++ seqlock data races; seq_cst keeps
// the matching block-start frame and PPQ indivisible to readers on every CPU.
class HostPositionClock {
    std::atomic<uint64_t> sequence{0},frame{0};
    std::atomic<double> rate{48000},tempo{120},ppq{0},cycleStart{0},cycleEnd{0};
    std::atomic<bool> musical{false},cycleActive{false};
public:
    void publish(const HostPosition& p) {
        sequence.fetch_add(1);
        frame.store(p.frame);rate.store(p.rate);tempo.store(p.tempo);ppq.store(p.ppq);
        cycleStart.store(p.cycleStart);cycleEnd.store(p.cycleEnd);
        musical.store(p.musical);cycleActive.store(p.cycleActive);
        sequence.fetch_add(1);
    }
    bool read(HostPosition& p) const {
        for(unsigned attempt=0;attempt<64;++attempt){
            const auto before=sequence.load();if(!before||(before&1))continue;
            HostPosition candidate{frame.load(),rate.load(),tempo.load(),ppq.load(),cycleStart.load(),cycleEnd.load(),musical.load(),cycleActive.load()};
            if(sequence.load()==before){p=candidate;return true;}
        }
        return false;
    }
};
}
