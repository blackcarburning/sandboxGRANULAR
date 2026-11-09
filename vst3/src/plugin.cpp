#include "core.h"
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
#ifdef _WIN32
class BridgeView final : public CPluginView {
    Bridge& owner;
    HWND window=nullptr;
    ULONG_PTR graphicsToken=0;
    Gdiplus::Image* logo=nullptr;
    IStream* logoStream=nullptr;
    bool openPending=false,copyPending=false;
    ULONGLONG launchCooldown=0;
    float displayLeft=0,displayRight=0;
    uint32_t displayFlags=UINT32_MAX;int meterLeftPixels=-1,meterRightPixels=-1,inputMeterCode=-1;
    std::wstring stateTitle,stateDetail;
    static LRESULT CALLBACK windowProc(HWND,UINT,WPARAM,LPARAM);
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
class Bridge final : public SingleComponentEffect {
public:
    Engine engine{isFx};
    std::atomic<float> peakLeft{0},peakRight{0};
    std::unique_ptr<Server> server;
    static FUnknown* create(void*) {return static_cast<IComponent*>(new Bridge);}
    Bridge(){engine.active.store(false);processContextRequirements.needProjectTimeMusic().needTempo().needBarPositionMusic().needTimeSignature().needTransportState().needCycleMusic();}
    ~Bridge() override {server.reset();}
    void enable(){if(!server){server=std::make_unique<Server>(engine);server->start();}}
    tresult PLUGIN_API initialize(FUnknown* host) override {
        const auto result=SingleComponentEffect::initialize(host);if(result!=kResultOk)return result;
        if(isFx){addAudioInput(STR16("DAW stereo input"),SpeakerArr::kStereo);parameters.addParameter(STR16("Bypass"),nullptr,1,0,ParameterInfo::kCanAutomate|ParameterInfo::kIsBypass,100);}
        addAudioOutput(STR16("MYGRAIN stereo"),SpeakerArr::kStereo);
        if(!isFx)addEventInput(STR16("MIDI"));
        return kResultOk;
    }
    tresult PLUGIN_API terminate() override {server.reset();return SingleComponentEffect::terminate();}
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
    tresult PLUGIN_API setState(IBStream* stream) override {
        if(!stream)return kInvalidArgument;
        if(isFx){uint32_t data[4]{};int32 read=0;if(stream->read(data,sizeof(data),&read)!=kResultOk||read!=sizeof(data)||data[0]!=0x3158474d||data[1]!=1||(data[2]&~3u)||data[3]>1000000)return kResultFalse;if(!engine.armExplicitlyChosen.load())engine.armed.store((data[2]&1u)!=0);engine.fx->bypass.store((data[2]&2u)!=0);setParamNormalized(100,(data[2]&2u)?1:0);engine.fx->mix.store(data[3]/1000000.);engine.requestPause();return kResultOk;}
        uint32_t data[2]{};int32 read=0;if(stream->read(data,sizeof(data),&read)!=kResultOk||read!=sizeof(data)||data[0]!=0x3142474d||(data[1]!=1&&data[1]!=2))return kResultFalse;
        if(data[1]==2){uint32_t flags=0;if(stream->read(&flags,sizeof(flags),&read)!=kResultOk||read!=sizeof(flags)||(flags&~1u))return kResultFalse;if(!engine.armExplicitlyChosen.load())engine.armed.store((flags&1u)!=0);}
        // Host state/lifecycle refreshes are not an explicit user disarm.
        engine.requestPause();return kResultOk;
    }
    tresult PLUGIN_API getState(IBStream* stream) override {
        if(!stream)return kInvalidArgument;
        if(isFx){uint32_t data[4]{0x3158474d,1,(engine.armed.load()?1u:0u)|(engine.fx->bypass.load()?2u:0u),uint32_t(std::llround(engine.fx->mix.load()*1000000))};int32 written=0;return stream->write(data,sizeof(data),&written)==kResultOk&&written==sizeof(data)?kResultOk:kResultFalse;}
        uint32_t data[3]{0x3142474d,2,engine.armed.load()?1u:0u};int32 written=0;
        return stream->write(data,sizeof(data),&written)==kResultOk&&written==sizeof(data)?kResultOk:kResultFalse;
    }
    tresult PLUGIN_API setComponentState(IBStream* stream) override {return isFx?setState(stream):kResultOk;}
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
        }else{
            float* l=output&&output->numChannels>0?output->channelBuffers32[0]:nullptr;
            float* r=output&&output->numChannels>1?output->channelBuffers32[1]:nullptr;
            engine.process(l,r,data.numSamples,host,input&&input->numChannels>0&&!(input->silenceFlags&1u)?input->channelBuffers32[0]:nullptr,input&&input->numChannels>1&&!(input->silenceFlags&2u)?input->channelBuffers32[1]:nullptr);
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
#ifdef _WIN32
#include "editor.inc"
#endif
}
#ifdef __APPLE__
#include "editor_mac.inc"
#endif
BEGIN_FACTORY_DEF("MYGRAIN","https://openclaw.blackcarburning.com/mygrain/","mailto:claw@blackcarburning.com")
#ifdef MYGRAIN_FX
DEF_CLASS2(INLINE_UID(0x80192c74,0x1fca4fa0,0xa638de42,0xf66c7d18),PClassInfo::kManyInstances,kVstAudioEffectClass,"MYGRAIN FX",0,"Fx|Filter","0.1.0",kVstVersionString,mygrain::Bridge::create)
#else
DEF_CLASS2(INLINE_UID(0x5df4d5fa,0x7a0e4bc6,0xb61ae905,0x6da13821),PClassInfo::kManyInstances,kVstAudioEffectClass,"MYGRAIN Bridge",0,"Instrument|Synth","0.5.0",kVstVersionString,mygrain::Bridge::create)
#endif
END_FACTORY
