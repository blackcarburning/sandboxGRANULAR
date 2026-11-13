#include "core.h"
#include "base/source/timer.h"
#include "server.h"
#include "public.sdk/source/vst/vstsinglecomponenteffect.h"
#include "public.sdk/source/common/pluginview.h"
#include "public.sdk/source/main/pluginfactory.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/vstspeaker.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include <memory>
#include <cstring>
#include <sstream>
#include <cwchar>
#ifdef MYGRAIN_CEF
#include "../cef/session.h"
#include "../cef/keyboard.h"
#include "../cef/toolbar.h"
#endif
#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <objidl.h>
#include <gdiplus.h>
extern HINSTANCE ghInst;
#endif
#ifdef __APPLE__
#import <Cocoa/Cocoa.h>
#endif
using namespace Steinberg;
using namespace Steinberg::Vst;
namespace mygrain {
#ifdef MYGRAIN_FX
constexpr bool isFx=true;
#else
constexpr bool isFx=false;
#endif
class Bridge;
#if defined(MYGRAIN_CEF) && (defined(_WIN32) || defined(__APPLE__))
class BridgeView final : public CPluginView {
    Bridge& owner;
    void* native=nullptr;
public:
    explicit BridgeView(Bridge& b);
    ~BridgeView() override;
    tresult PLUGIN_API isPlatformTypeSupported(FIDString type) override {
#ifdef _WIN32
        return type&&std::strcmp(type,kPlatformTypeHWND)==0?kResultTrue:kResultFalse;
#else
        return type&&std::strcmp(type,kPlatformTypeNSView)==0?kResultTrue:kResultFalse;
#endif
    }
    tresult PLUGIN_API attached(void* parent,FIDString type) override;
    tresult PLUGIN_API removed() override;
    tresult PLUGIN_API canResize() override {return kResultTrue;}
    tresult PLUGIN_API onSize(ViewRect* size) override;
    tresult PLUGIN_API onKeyDown(char16 key,int16 code,int16 modifiers) override;
    tresult PLUGIN_API onKeyUp(char16 key,int16 code,int16 modifiers) override;
    tresult PLUGIN_API onFocus(TBool state) override;
    tresult PLUGIN_API checkSizeConstraint(ViewRect* size) override {if(!size)return kInvalidArgument;size->right=size->left+std::clamp(size->getWidth(),800,2048);size->bottom=size->top+std::clamp(size->getHeight(),500,1600);return kResultOk;}
};
#elif defined(_WIN32)
class BridgeView final : public CPluginView {
    Bridge& owner;
    HWND window=nullptr;
    ULONG_PTR graphicsToken=0;
    Gdiplus::Image* logo=nullptr;
    IStream* logoStream=nullptr;
    std::array<Gdiplus::Image*,12> potImages{};std::array<IStream*,12> potStreams{};int dragRow=-1,dragStart=0;bool rowDragged=false;
    bool openPending=false,copyPending=false;
    ULONGLONG launchCooldown=0;
    float displayLeft=0,displayRight=0;
    uint32_t displayFlags=UINT32_MAX;int meterLeftPixels=-1,meterRightPixels=-1,inputMeterCode=-1;
    std::wstring stateTitle,stateDetail;
    RemoteState remoteDisplay;
    static LRESULT CALLBACK windowProc(HWND,UINT,WPARAM,LPARAM);
    static LRESULT CALLBACK rowProc(HWND,UINT,WPARAM,LPARAM);
    void tick();void launch();void copy();void paint(HDC);void paintButton(DRAWITEMSTRUCT*);
public:
    explicit BridgeView(Bridge& b);
    ~BridgeView() override;
    tresult PLUGIN_API isPlatformTypeSupported(FIDString type) override {return type&&std::strcmp(type,kPlatformTypeHWND)==0?kResultTrue:kResultFalse;}
    tresult PLUGIN_API attached(void* parent,FIDString type) override;
    tresult PLUGIN_API removed() override;
};
#elif defined(__APPLE__)
class BridgeView final : public CPluginView {
    Bridge& owner;
    void* native=nullptr;
public:
    explicit BridgeView(Bridge& b);
    ~BridgeView() override;
    tresult PLUGIN_API isPlatformTypeSupported(FIDString type) override {return type&&std::strcmp(type,kPlatformTypeNSView)==0?kResultTrue:kResultFalse;}
    tresult PLUGIN_API attached(void* parent,FIDString type) override;
    tresult PLUGIN_API removed() override;
};
#endif
class Bridge final : public SingleComponentEffect, public ITimerCallback {
public:
#ifdef MYGRAIN_CEF
    // Component-owned, not view-owned: audio and automatic stores survive removed().
    cef::Session embedded;
    cef::PreviewReader previewReader;
#endif
    Timer* projectTimer=nullptr;
    uint32_t notifiedProject=0;
    void stopProjectTimer(){engine.project.supportsDirty.store(false);if(projectTimer){projectTimer->stop();projectTimer->release();projectTimer=nullptr;}}
    void onTimer(Timer*) override {
        const auto revision=engine.project.dirtyRevision.load(std::memory_order_acquire);
        if(revision!=notifiedProject&&setDirty(true)==kResultOk){notifiedProject=revision;engine.project.dirtyNotified.store(revision,std::memory_order_release);}
    }
    tresult PLUGIN_API setComponentHandler(IComponentHandler* handler) override {
        stopProjectTimer();const auto result=SingleComponentEffect::setComponentHandler(handler);
        // SDK platform timer dispatches on the host UI/main runloop, independently
        // of editor lifetime. Never call a host callback from socket/audio threads.
        if(result==kResultOk&&componentHandler2)projectTimer=Timer::create(this,100);
        engine.project.supportsDirty.store(projectTimer!=nullptr);
        return result;
    }
    Engine engine{isFx};
    std::atomic<float> peakLeft{0},peakRight{0};
    std::unique_ptr<Server> server;
    static FUnknown* create(void*) {return static_cast<IComponent*>(new Bridge);}
    Bridge(){engine.active.store(false);processContextRequirements.needProjectTimeMusic().needTempo().needBarPositionMusic().needTimeSignature().needTransportState().needCycleMusic();}
    ~Bridge() override {
#ifdef MYGRAIN_CEF
        embedded.stop();
#endif
        server.reset();stopProjectTimer();}
    void enable(){if(!server){server=std::make_unique<Server>(engine);server->start();}}
    tresult PLUGIN_API initialize(FUnknown* host) override {
        const auto result=SingleComponentEffect::initialize(host);if(result!=kResultOk)return result;
        if(isFx){addAudioInput(STR16("DAW stereo input"),SpeakerArr::kStereo);parameters.addParameter(STR16("Bypass"),nullptr,1,0,ParameterInfo::kCanAutomate|ParameterInfo::kIsBypass,100);}
        addAudioOutput(STR16("MYGRAIN stereo"),SpeakerArr::kStereo);
        if(!isFx)addEventInput(STR16("MIDI"));
        return kResultOk;
    }
    tresult PLUGIN_API terminate() override {
#ifdef MYGRAIN_CEF
        embedded.stop();
#endif
        server.reset();stopProjectTimer();return SingleComponentEffect::terminate();}
    tresult PLUGIN_API setBusArrangements(SpeakerArrangement* inputs,int32 numIns,SpeakerArrangement* outputs,int32 numOuts) override {
        return numIns==(isFx?1:0)&&(!isFx||(inputs&&inputs[0]==SpeakerArr::kStereo))&&numOuts==1&&outputs&&outputs[0]==SpeakerArr::kStereo?kResultTrue:kResultFalse;
    }
    tresult PLUGIN_API canProcessSampleSize(int32 size) override {return size==kSample32||size==kSample64?kResultTrue:kResultFalse;}
    tresult PLUGIN_API setupProcessing(ProcessSetup& setup) override {
        if(!std::isfinite(setup.sampleRate)||setup.sampleRate<8000||setup.sampleRate>(isFx?192000:384000)||setup.maxSamplesPerBlock<1)return kInvalidArgument;
        if(isFx)engine.fx->lifecycleReset();
        engine.sampleRate.store(setup.sampleRate);return SingleComponentEffect::setupProcessing(setup);
    }
    bool preparedTransport() const {return engine.preparedMode.load()||engine.prepared.hasPending();}
    tresult PLUGIN_API setProcessing(TBool state) override {
        engine.active.store(bool(state));
        if(!state){engine.requestPause();engine.reset();if(isFx)engine.fx->lifecycleReset();}
        return kResultOk;
    }
    tresult PLUGIN_API setActive(TBool state) override {if(!state)engine.requestPause();return kResultOk;}
    static bool readBytes(IBStream* stream,void* target,size_t bytes){
        auto* p=static_cast<char*>(target);while(bytes){int32 n=0;const auto want=int32(std::min<size_t>(bytes,65536));stream->read(p,want,&n);if(n<=0||n>want)return false;p+=n;bytes-=n;}return true;
    }
    static bool writeBytes(IBStream* stream,const void* source,size_t bytes){
        auto* p=static_cast<const char*>(source);while(bytes){int32 n=0;const auto want=int32(std::min<size_t>(bytes,65536));if(stream->write(const_cast<char*>(p),want,&n)!=kResultOk||n<=0||n>want)return false;p+=n;bytes-=n;}return true;
    }
    tresult PLUGIN_API setState(IBStream* stream) override {
        if(!stream)return kInvalidArgument;
        try {
            uint32_t first[2]{};if(!readBytes(stream,first,sizeof(first))||first[0]!=(isFx?0x3158474du:0x3142474du))return kResultFalse;
            uint32_t flags=0,mix=1000000;bool modern=first[1]==(isFx?2u:3u);
            if(!modern&&!(first[1]==1||(!isFx&&first[1]==2)))return kResultFalse;
            if(isFx||first[1]>=2)if(!readBytes(stream,&flags,4)||(flags&~(modern?7u:isFx?3u:1u)))return kResultFalse;
            if(isFx||modern)if(!readBytes(stream,&mix,4)||mix>1000000)return kResultFalse;
            std::shared_ptr<SavedProject> value;
            if(modern){
                uint32_t header[4]{};double timing[2]{};
                if(!readBytes(stream,header,sizeof(header))||!readBytes(stream,timing,sizeof(timing))||header[0]>maxProjectBytes||header[3]>maxPreparedFrames)return kResultFalse;
                const bool rendered=(flags&4u)!=0;
                if(header[0]){
                    value=std::make_shared<SavedProject>();value->crc=header[1];value->rendered=rendered;value->document.resize(header[0]);
                    if(!readBytes(stream,value->document.data(),value->document.size())||!validProjectDocument(value->document)||projectCrc(value->document.data(),value->document.size())!=value->crc)return kResultFalse;
                    if(rendered){
                        if(isFx)return kResultFalse;
                        auto loop=std::make_shared<SavedLoop>();loop->rate=header[2];loop->beats=timing[0];loop->bpm=timing[1];loop->pcm.resize(size_t(header[3])*2);
                        if(!readBytes(stream,loop->pcm.data(),loop->pcm.size()*4)||!validSavedLoop(*loop))return kResultFalse;
                        value->loop=loop;
                    }else if(header[2]||header[3]||timing[0]||timing[1])return kResultFalse;
                }else if(rendered||header[1]||header[2]||header[3]||timing[0]||timing[1])return kResultFalse;
                // Parsing completes before changing active state. Publication allocates
                // here, never in process(), and safely replaces a not-yet-adopted slot.
                if(value&&value->loop){auto pcm=value->loop->pcm;if(!engine.prepared.publish(std::move(pcm),value->loop->rate,value->loop->beats,value->loop->bpm,engine.project.revision.load()+1,true))return kResultFalse;}
                engine.project.restore(value);engine.browserReady.store(false);
                if(!isFx){if(value&&value->rendered)engine.requestRendered();else engine.requestLive();}
            }
            if(!engine.armExplicitlyChosen.load())engine.armed.store((flags&1u)!=0);
            if(isFx){engine.fx->bypass.store((flags&2u)!=0);setParamNormalized(100,(flags&2u)?1:0);engine.fx->mix.store(mix/1000000.);}
            if(!modern||isFx)engine.requestPause();return kResultOk;
        }catch(const std::exception&){return kResultFalse;}
    }
    tresult PLUGIN_API getState(IBStream* stream) override {
        if(!stream)return kInvalidArgument;
        const auto value=engine.project.get();const auto loop=value?value->loop:nullptr;
        uint32_t first[8]{isFx?0x3158474du:0x3142474du,isFx?2u:3u,(engine.armed.load()?1u:0u)|(isFx&&engine.fx->bypass.load()?2u:0u)|(value&&value->rendered?4u:0u),isFx?uint32_t(std::llround(engine.fx->mix.load()*1000000)):1000000u,value?uint32_t(value->document.size()):0,value?value->crc:0,loop?loop->rate:0,loop?uint32_t(loop->pcm.size()/2):0};
        double timing[2]{loop?loop->beats:0,loop?loop->bpm:0};
        return writeBytes(stream,first,sizeof(first))&&writeBytes(stream,timing,sizeof(timing))&&(!value||writeBytes(stream,value->document.data(),value->document.size()))&&(!loop||writeBytes(stream,loop->pcm.data(),loop->pcm.size()*4))?kResultOk:kResultFalse;
    }
    // Single-component plugin: controller state must not reapply processor state.
    tresult PLUGIN_API setComponentState(IBStream*) override {return kResultOk;}
    // A scheduled source has no input-path latency. Its first sample is presented
    // at the chosen DAW bar; the 350 ms browser lookahead is NOT reported as PDC.
    uint32 PLUGIN_API getLatencySamples() override {return isFx?engine.fx->latency(engine.sampleRate.load()):0;}
    uint32 PLUGIN_API getTailSamples() override {return isFx?kInfiniteTail:0;}
    tresult PLUGIN_API process(ProcessData& data) override {
        if(data.numSamples<0||data.numSamples>processSetup.maxSamplesPerBlock)return kInvalidArgument;
        HostBlock host;host.rate=processSetup.sampleRate;host.offline=data.processMode==kOffline;
        if(const auto* c=data.processContext){
            host.timingValid=true;host.projectSample=c->projectTimeSamples;host.playing=(c->state&ProcessContext::kPlaying)!=0;
            host.musicalValid=(c->state&ProcessContext::kProjectTimeMusicValid)&&(c->state&ProcessContext::kTempoValid);
            if(c->state&ProcessContext::kTempoValid)host.tempo=std::isfinite(c->tempo)?c->tempo:0;
            if(c->state&ProcessContext::kProjectTimeMusicValid)host.ppq=std::isfinite(c->projectTimeMusic)?c->projectTimeMusic:0;
            if((c->state&ProcessContext::kBarPositionValid)&&std::isfinite(c->barPositionMusic)){host.barStart=c->barPositionMusic;host.barValid=true;}
            host.cycleActive=(c->state&ProcessContext::kCycleActive)!=0;
            if((c->state&ProcessContext::kCycleValid)&&std::isfinite(c->cycleStartMusic)&&std::isfinite(c->cycleEndMusic)&&c->cycleEndMusic>c->cycleStartMusic){host.cycleValid=true;host.cycleStart=c->cycleStartMusic;host.cycleEnd=c->cycleEndMusic;}
            if(c->state&ProcessContext::kTimeSigValid){host.numerator=std::clamp(c->timeSigNumerator,1,64);host.denominator=std::clamp(c->timeSigDenominator,1,64);}
        }
        if(isFx&&data.inputParameterChanges){for(int32 i=0;i<data.inputParameterChanges->getParameterCount();++i){auto* queue=data.inputParameterChanges->getParameterData(i);if(queue&&queue->getParameterId()==100){int32 offset;ParamValue value;if(queue->getPoint(queue->getPointCount()-1,offset,value)==kResultTrue)engine.fx->bypass.store(value>=.5);}}}
        AudioBusBuffers* input=isFx&&data.numInputs>0&&data.inputs?&data.inputs[0]:nullptr;
        AudioBusBuffers* output=data.numOutputs>0&&data.outputs?&data.outputs[0]:nullptr;
        if(data.symbolicSampleSize==kSample64){
            double* l=output&&output->numChannels>0?output->channelBuffers64[0]:nullptr;
            double* r=output&&output->numChannels>1?output->channelBuffers64[1]:nullptr;
            engine.process(l,r,data.numSamples,host,input&&input->numChannels>0&&!(input->silenceFlags&1u)?input->channelBuffers64[0]:nullptr,input&&input->numChannels>1&&!(input->silenceFlags&2u)?input->channelBuffers64[1]:nullptr);
#ifdef MYGRAIN_CEF
            if(auto* audio=embedded.audio.load(std::memory_order_acquire))previewReader.mix(*audio,l,r,data.numSamples,host.rate,host.offline||(isFx&&engine.fx->bypass.load()));
#endif
        }else{
            float* l=output&&output->numChannels>0?output->channelBuffers32[0]:nullptr;
            float* r=output&&output->numChannels>1?output->channelBuffers32[1]:nullptr;
            engine.process(l,r,data.numSamples,host,input&&input->numChannels>0&&!(input->silenceFlags&1u)?input->channelBuffers32[0]:nullptr,input&&input->numChannels>1&&!(input->silenceFlags&2u)?input->channelBuffers32[1]:nullptr);
#ifdef MYGRAIN_CEF
            if(auto* audio=embedded.audio.load(std::memory_order_acquire))previewReader.mix(*audio,l,r,data.numSamples,host.rate,host.offline||(isFx&&engine.fx->bypass.load()));
#endif
        }
        float leftPeak=0,rightPeak=0;
        if(output&&output->numChannels>0){
            for(int32 i=0;i<data.numSamples;++i){
                if(data.symbolicSampleSize==kSample64){leftPeak=std::max(leftPeak,float(std::abs(output->channelBuffers64[0][i])));if(output->numChannels>1)rightPeak=std::max(rightPeak,float(std::abs(output->channelBuffers64[1][i])));}
                else{leftPeak=std::max(leftPeak,std::abs(output->channelBuffers32[0][i]));if(output->numChannels>1)rightPeak=std::max(rightPeak,std::abs(output->channelBuffers32[1][i]));}
            }
        }
        peakLeft.store(leftPeak,std::memory_order_relaxed);peakRight.store(rightPeak,std::memory_order_relaxed);
        if(output)output->silenceFlags=(leftPeak>0||rightPeak>0)?0:3;
        return kResultOk;
    }
    IPlugView* PLUGIN_API createView(FIDString name) override {
#if defined(_WIN32) || defined(__APPLE__)
        if(name&&std::strcmp(name,ViewType::kEditor)==0)return new BridgeView(*this);
#else
        (void)name;
#endif
        return nullptr;
    }
};
#if defined(MYGRAIN_CEF) && defined(_WIN32)
#include "../cef/editor_win.inc"
#elif defined(_WIN32)
#include "editor.inc"
#endif
}
#if defined(MYGRAIN_CEF) && defined(__APPLE__)
#include "../cef/editor_mac.inc"
#elif defined(__APPLE__)
#include "editor_mac.inc"
#endif
BEGIN_FACTORY_DEF("MYGRAIN","https://openclaw.blackcarburning.com/mygrain/","mailto:claw@blackcarburning.com")
#if defined(MYGRAIN_CEF) && defined(MYGRAIN_FX)
DEF_CLASS2(INLINE_UID(0x2642d59b,0x6c824e31,0x9ade03f7,0xb8562c10),PClassInfo::kManyInstances,kVstAudioEffectClass,"MyGrain CEF FX",0,"Fx|Filter","0.1.1",kVstVersionString,mygrain::Bridge::create)
#elif defined(MYGRAIN_CEF)
DEF_CLASS2(INLINE_UID(0xa44b25e1,0x3de64853,0xa16cc639,0x21c9d4b2),PClassInfo::kManyInstances,kVstAudioEffectClass,"MyGrain CEF",0,"Instrument|Synth","0.1.4",kVstVersionString,mygrain::Bridge::create)
#elif defined(MYGRAIN_FX)
DEF_CLASS2(INLINE_UID(0x80192c74,0x1fca4fa0,0xa638de42,0xf66c7d18),PClassInfo::kManyInstances,kVstAudioEffectClass,"MYGRAIN FX",0,"Fx|Filter","0.4.0",kVstVersionString,mygrain::Bridge::create)
#else
DEF_CLASS2(INLINE_UID(0x5df4d5fa,0x7a0e4bc6,0xb61ae905,0x6da13821),PClassInfo::kManyInstances,kVstAudioEffectClass,"MYGRAIN Bridge",0,"Instrument|Synth","0.8.0",kVstVersionString,mygrain::Bridge::create)
#endif
END_FACTORY
