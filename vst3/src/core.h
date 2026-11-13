#pragma once
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>
#include "prepared.h"
#include "project.h"
#include "remote.h"
#include "fx.h"
#include <memory>

namespace mygrain {
constexpr uint32_t capacity = 1u << 18;
constexpr double leadSeconds = 1.0;
constexpr double bufferSeconds = 0.35;
struct Stereo { float l = 0, r = 0; uint32_t epoch=0; };

// One socket-thread producer; one DAW-thread consumer. Only the consumer resets.
class AudioRing {
    std::vector<Stereo> data = std::vector<Stereo>(capacity);
    alignas(64) std::atomic<uint64_t> written {0};
    alignas(64) std::atomic<uint64_t> read {0};
public:
    uint64_t size() const { return written.load(std::memory_order_acquire) - read.load(std::memory_order_acquire); }
    bool push(const float* interleaved, uint32_t count, uint32_t epoch=0) {
        const auto w = written.load(std::memory_order_relaxed);
        const auto r = read.load(std::memory_order_acquire);
        if (count > capacity || w - r + count > capacity) return false;
        for (uint32_t i=0; i<count; ++i) {
            const float l=interleaved[i*2], rr=interleaved[i*2+1];
            data[(w+i)&(capacity-1)] = {std::isfinite(l)?std::clamp(l,-16.f,16.f):0.f,
                                      std::isfinite(rr)?std::clamp(rr,-16.f,16.f):0.f,epoch};
        }
        written.store(w+count,std::memory_order_release);
        return true;
    }
    Stereo at(uint32_t offset) const { return data[(read.load(std::memory_order_relaxed)+offset)&(capacity-1)]; }
    void consume(uint32_t count) { read.fetch_add(count,std::memory_order_release); }
    void clear() { read.store(written.load(std::memory_order_acquire),std::memory_order_release); }
};

struct HostBlock {
    double rate=48000, tempo=120, ppq=0, barStart=0, cycleStart=0, cycleEnd=0;
    int64_t projectSample=0;
    int numerator=4, denominator=4;
    bool playing=false, musicalValid=false, offline=false, timingValid=false, barValid=false, cycleActive=false, cycleValid=false;
};

class Engine {
    double fraction=0, correction=0, smoothedFill=bufferSeconds, targetFill=bufferSeconds, fade=0, previousTempo=120;
    int previousNumerator=4, previousDenominator=4;
    bool wasPlaying=false, havePosition=false, wasOffline=false, wasLiveAvailable=false, renderedRequested=false, holding=false;
    int64_t expectedProject=0;
    double expectedPpq=0, auditionBeat=0;
    bool preparedAudition=false;
    uint32_t seenGeneration=0;
public:
    std::unique_ptr<FxTransport> fx;
    explicit Engine(bool effect=false){if(effect)fx=std::make_unique<FxTransport>();}
    AudioRing ring;
    PreparedBank prepared;
    ProjectStore project;
    RemoteControl remote;
    std::atomic<bool> preparedMode{false};
    std::atomic<uint32_t> preparedRevision{0}, preparedFrames{0};
    std::atomic<double> preparedBeats{0}, preparedBpm{120};
    std::atomic<uint64_t> cycleWraps{0}, timelineJumps{0};
    std::atomic<bool> browserReady{false}, armExplicitlyChosen{false};
    std::atomic<bool> connected{false}, armed{false}, running{false}, offline{false}, active{true};
    std::atomic<uint32_t> command{0}, generation{1}, sourceRate{48000};
    std::atomic<uint64_t> clock{0}, target{0}, underflows{0}, overflows{0}, received{0};
    std::atomic<double> sampleRate{48000}, tempo{120}, ppq{0}, fillMs{0}, driftPpm{0};
    std::atomic<int> numerator{4}, denominator{4};
    std::atomic<bool> playing{false}, musicalValid{false}, hostTimingValid{false}, hostCycleActive{false};
    std::atomic<double> hostCycleStart{0},hostCycleEnd{0};
    // Commands are posted by socket/UI threads and consumed only in process().
    void requestArm() { armExplicitlyChosen.store(true); armed.store(true); command.store(3); }
    void requestStart() { armExplicitlyChosen.store(true); armed.store(true); command.store(1); }
    void requestStop() { armExplicitlyChosen.store(true); armed.store(false); command.store(2); }
    void requestPause() { command.store(5); }
    void requestHold() { command.store(7); }
    void requestLive() { command.store(4); }
    void requestRendered() { command.store(6); }
    void reset() {
        running.store(false); target.store(0); ring.clear(); fraction=0; correction=0; fade=0;
        smoothedFill=bufferSeconds;targetFill=bufferSeconds;
        seenGeneration=generation.fetch_add(1,std::memory_order_acq_rel)+1;
    }
    void schedule(const HostBlock& h, uint64_t now) {
        reset();
        double seconds=leadSeconds;
        if (h.playing && h.musicalValid && h.tempo>=1 && h.tempo<=300) {
            const double bar=std::max(1,h.numerator)*4.0/std::max(1,h.denominator);
            const double earliest=h.ppq+leadSeconds*h.tempo/60.;
            const double anchor=h.barValid?h.barStart:0.;
            const double next=anchor+std::ceil((earliest-anchor-1e-9)/bar)*bar;
            seconds=std::max(leadSeconds,(next-h.ppq)*60./h.tempo);
        }
        target.store(now+static_cast<uint64_t>(std::llround(seconds*h.rate)),std::memory_order_release);
    }
    template<class Sample> void process(Sample* l, Sample* r, int frames, const HostBlock& h, const Sample* inputLeft=nullptr, const Sample* inputRight=nullptr) {
        sampleRate.store(h.rate); tempo.store(h.tempo); ppq.store(h.ppq);
        numerator.store(h.numerator); denominator.store(h.denominator);
        playing.store(h.playing); musicalValid.store(h.musicalValid);hostTimingValid.store(h.timingValid);offline.store(h.offline);
        hostCycleActive.store(h.cycleActive&&h.cycleValid);hostCycleStart.store(h.cycleStart);hostCycleEnd.store(h.cycleEnd);
        const auto now=clock.load(std::memory_order_relaxed);
        const auto cmd=command.exchange(0);
        if(fx){
            const bool available=connected.load()&&browserReady.load()&&!project.recallPending.load()&&armed.load()&&!h.offline&&active.load();
            running.store(fx->process(l,r,inputLeft,inputRight,frames,h.rate,now,available,cmd,generation));
            clock.store(now+std::max(0,frames),std::memory_order_release);return;
        }
        const bool jump=h.timingValid && havePosition && h.playing && wasPlaying && std::abs(h.projectSample-expectedProject)>std::max(2,frames);
        const double cycle=h.cycleEnd-h.cycleStart;
        double wrapped=expectedPpq;
        if(h.cycleValid&&cycle>0&&wrapped>=h.cycleEnd-1e-8)wrapped=h.cycleStart+std::fmod(wrapped-h.cycleStart,cycle);
        const bool cycleWrap=jump&&h.musicalValid&&h.cycleActive&&h.cycleValid&&cycle>0&&
            expectedPpq>=h.cycleEnd-1e-8&&h.ppq>=h.cycleStart-1e-8&&h.ppq<h.cycleEnd&&
            std::abs(h.ppq-wrapped)<=std::max(1e-7,2.*h.tempo/(60.*h.rate));
        if(cycleWrap)cycleWraps.fetch_add(1,std::memory_order_relaxed);
        if(jump)timelineJumps.fetch_add(1,std::memory_order_relaxed);
        const bool changed=h.playing&&wasPlaying&&(std::abs(h.tempo-previousTempo)>.0001||h.numerator!=previousNumerator||h.denominator!=previousDenominator);
        previousTempo=h.tempo;previousNumerator=h.numerator;previousDenominator=h.denominator;
        const bool started=h.playing&&!wasPlaying;
        const bool stopped=!h.playing&&wasPlaying;
        const bool resumed=wasOffline&&!h.offline;wasOffline=h.offline;
        wasPlaying=h.playing; havePosition=h.timingValid;
        expectedProject=h.projectSample+frames;
        expectedPpq=h.ppq+frames*h.tempo/(60.*h.rate);
        if(prepared.adopt()) {
            reset();holding=false;preparedAudition=false;renderedRequested=true;preparedMode.store(true);
            preparedFrames.store(prepared.frames());preparedBeats.store(prepared.beats());preparedBpm.store(prepared.bpm());
            preparedRevision.store(prepared.revision(),std::memory_order_release);
        }
        if(cmd==1||cmd==3)holding=false;
        if(cmd==7){holding=true;reset();}
        if(cmd==4||cmd==6){holding=false;renderedRequested=cmd==6;preparedMode.store(renderedRequested&&prepared.valid());preparedAudition=false;reset();}
        if(preparedMode.load(std::memory_order_relaxed)) {
            if(cmd==1){preparedAudition=true;auditionBeat=0;}
            if(cmd==2||cmd==3||cmd==5||cmd==6||cmd==7||stopped)preparedAudition=false;
            const bool audible=!holding&&(connected.load()||project.rendered.load())&&armed.load()&&(h.playing||preparedAudition)&&h.musicalValid&&std::isfinite(h.ppq)&&h.tempo>=1&&h.tempo<=300;
            const double beatStep=h.tempo/(60.*std::max(1.,h.rate));
            double beat=h.playing?h.ppq:auditionBeat;
            for(int i=0;i<frames;++i){
                float left=0,right=0;
                if(audible){
                    double position=beat;
                    // Hosts normally split at the wrap; also handle a boundary
                    // inside a supplied block without inserting silence.
                    if(h.playing&&h.cycleActive&&h.cycleValid&&cycle>0&&position>=h.cycleEnd)
                        position=h.cycleStart+std::fmod(position-h.cycleStart,cycle);
                    prepared.sample(position,left,right);
                }
                if(l)l[i]=Sample(left);
                if(r)r[i]=Sample(right);
                beat+=beatStep;
            }
            if(preparedAudition)auditionBeat=beat;
            running.store(audible);fillMs.store(0);driftPpm.store(0);clock.store(now+std::max(0,frames),std::memory_order_release);return;
        }
        // Live is a continuous performance, NOT a timeline reader. Preserve the
        // queue at every loop/seek, even when the host omits cycle metadata.
        // Explicit stop/start, tempo changes and real starvation still re-arm.
        const bool available=connected.load()&&browserReady.load()&&!project.recallPending.load()&&!h.offline&&!renderedRequested&&!holding;
        const bool becameAvailable=available&&!wasLiveAvailable;wasLiveAvailable=available;
        if(cmd==5){reset();preparedAudition=false;}
        if(cmd==2 || (cmd==3&&!h.playing) || stopped || !available || !armed.load()) {
            if(target.load()||running.load()||ring.size()) reset();
        } else if(armed.load() && (cmd==1 || started || changed || (h.playing&&(cmd==3||cmd==4||cmd==5||resumed||becameAvailable)))) schedule(h,now);
        if(generation.load()!=seenGeneration) { ring.clear(); seenGeneration=generation.load(); fraction=0; fade=0; }
        const auto start=target.load(std::memory_order_acquire);
        const double src=sourceRate.load(), ratio=src/std::max(1.,h.rate);
        const double fill=ring.size()/src;
        smoothedFill += (fill-smoothedFill)*std::min(.02,frames/std::max(1.,h.rate)*.5);
        if(running.load()) correction=std::clamp((smoothedFill-targetFill)*.02,-.002,.002);
        const double step=ratio*(1+correction);
        fillMs.store(fill*1000); driftPpm.store(correction*1e6);
        bool failed=false;
        for(int i=0;i<frames;++i) {
            Stereo out;
            if(available && armed.load(std::memory_order_relaxed) && start && now+uint64_t(i)>=start && !failed) {
                while(ring.size() && ring.at(0).epoch!=seenGeneration) ring.consume(1);
                const uint32_t need=static_cast<uint32_t>(std::floor(fraction+step))+2;
                if(ring.size()>=need) {
                    if(!running.load(std::memory_order_relaxed)){targetFill=ring.size()/src;smoothedFill=targetFill;}
                    running.store(true,std::memory_order_relaxed);
                    const auto a=ring.at(0), b=ring.at(1);
                    out={float(a.l+(b.l-a.l)*fraction),float(a.r+(b.r-a.r)*fraction)};
                    fraction+=step;
                    const auto used=static_cast<uint32_t>(fraction); fraction-=used; ring.consume(used);
                    fade=std::min(1.,fade+1./std::max(1.,h.rate*.003));out.l*=float(fade);out.r*=float(fade);
                } else { underflows.fetch_add(1);failed=true; }
            }
            if(l) l[i]=Sample(out.l);
            if(r) r[i]=Sample(out.r);
        }
        clock.store(now+std::max(0,frames),std::memory_order_release);
        // Never let a late packet shift the loop: discard/re-arm at a new bar.
        if(failed) { if(armed.load() && connected.load()) { auto next=h;next.ppq+=frames*h.tempo/(60.*h.rate);schedule(next,now+frames); } else reset(); }
    }
};
static_assert(std::atomic<uint64_t>::is_always_lock_free,"64-bit lock-free atomics required");
static_assert(std::atomic<double>::is_always_lock_free,"lock-free clock fields required");
}
