// Runs against actual plugin factory, on both Windows/Wine and macOS.
#pragma once
#include <vector>
#include <cstring>
#include <cmath>
#include <iostream>
#include <atomic>
#include <thread>
// Stack-owned test handler. Controller releases it before the host scope ends.
class ProjectDirtyHandler final : public IComponentHandler,public IComponentHandler2 {
    std::atomic<uint32> refs{1};const std::thread::id ui=std::this_thread::get_id();
public:
    std::atomic<uint32> calls{0};std::atomic<bool> wrongThread{false};
    tresult PLUGIN_API queryInterface(const TUID iid,void** obj) override {
        if(!obj)return kInvalidArgument;*obj=nullptr;
        if(FUnknownPrivate::iidEqual(iid,IComponentHandler::iid)||FUnknownPrivate::iidEqual(iid,FUnknown::iid))*obj=static_cast<IComponentHandler*>(this);
        else if(FUnknownPrivate::iidEqual(iid,IComponentHandler2::iid))*obj=static_cast<IComponentHandler2*>(this);
        if(!*obj)return kNoInterface;addRef();return kResultOk;
    }
    uint32 PLUGIN_API addRef() override {return ++refs;}
    uint32 PLUGIN_API release() override {return --refs;}
    tresult PLUGIN_API beginEdit(ParamID) override {return kResultOk;}
    tresult PLUGIN_API performEdit(ParamID,ParamValue) override {return kResultOk;}
    tresult PLUGIN_API endEdit(ParamID) override {return kResultOk;}
    tresult PLUGIN_API restartComponent(int32) override {return kResultOk;}
    tresult PLUGIN_API setDirty(TBool value) override {if(std::this_thread::get_id()!=ui)wrongThread=true;if(value)calls++;return kResultOk;}
    tresult PLUGIN_API requestOpenEditor(FIDString) override {return kResultOk;}
    tresult PLUGIN_API startGroupEdit() override {return kResultOk;}
    tresult PLUGIN_API finishGroupEdit() override {return kResultOk;}
};
static bool checkProjectState(IPluginFactory* factory,const PClassInfo& info,HostApplication& host,IComponent*,MemoryStream& state){
 auto same=[](MemoryStream& a,MemoryStream& b){return a.getSize()==b.getSize()&&std::memcmp(a.getData(),b.getData(),a.getSize())==0;};
 IComponent* clone=nullptr;if(factory->createInstance(info.cid,IComponent::iid,(void**)&clone)!=kResultOk||clone->initialize(&host)!=kResultOk)return false;
 bool ok=true;const bool fx=clone->getBusCount(kAudio,kInput)==1;std::vector<char> bytes(state.getData(),state.getData()+state.getSize());
 MemoryStream saved(bytes.data(),bytes.size());ok=clone->setState(&saved)==kResultOk;
 MemoryStream observed;ok=ok&&clone->getState(&observed)==kResultOk&&same(state,observed);
 // Repeated state before a processing callback must replace the pending render safely.
 saved.seek(0,IBStream::kIBSeekSet,nullptr);ok=ok&&clone->setState(&saved)==kResultOk;
 for(size_t count:{size_t(7),size_t(20),size_t(47),bytes.size()-1}){
  MemoryStream truncated(bytes.data(),count);if(clone->setState(&truncated)==kResultOk)ok=false;
  MemoryStream after;clone->getState(&after);if(!same(observed,after))ok=false;
 }
 if(bytes.size()>48){auto corrupt=bytes;corrupt.back()^=0x40; // Corrupt document, not optional loop.
  uint32_t size=0;std::memcpy(&size,bytes.data()+16,4);corrupt[48+size-1]^=0x80;
  MemoryStream bad(corrupt.data(),corrupt.size());if(clone->setState(&bad)==kResultOk)ok=false;
  MemoryStream after;clone->getState(&after);if(!same(observed,after))ok=false;
 }
 uint32_t legacy[4]{fx?0x3158474du:0x3142474du,1,1,750000};MemoryStream old(legacy,fx?16:8);if(clone->setState(&old)!=kResultOk)ok=false;
 // Fresh rendered restore plays exact PCM offline without a socket/browser.
 uint32_t flags=0;std::memcpy(&flags,bytes.data()+8,4);
 if(!fx&&(flags&4u)){
  uint32_t armed=flags|1u;std::memcpy(bytes.data()+8,&armed,4);MemoryStream load(bytes.data(),bytes.size());ok=ok&&clone->setState(&load)==kResultOk;
  IAudioProcessor* processor=nullptr;clone->queryInterface(IAudioProcessor::iid,(void**)&processor);
  ProcessSetup setup{};setup.processMode=kOffline;setup.symbolicSampleSize=kSample64;setup.maxSamplesPerBlock=128;setup.sampleRate=48000;ok=ok&&processor->setupProcessing(setup)==kResultOk;
  clone->activateBus(kAudio,kOutput,0,true);clone->setActive(true);processor->setProcessing(true);
  double l[128]{},r[128]{};double* outputs[]{l,r};AudioBusBuffers output{};output.numChannels=2;output.channelBuffers64=outputs;
  ProcessContext context{};context.sampleRate=48000;context.tempo=120;context.projectTimeMusic=.125;context.state=ProcessContext::kPlaying|ProcessContext::kTempoValid|ProcessContext::kProjectTimeMusicValid;
  ProcessData data{};data.processMode=kOffline;data.symbolicSampleSize=kSample64;data.numSamples=128;data.numOutputs=1;data.outputs=&output;data.processContext=&context;
  ok=ok&&processor->process(data)==kResultOk;
  uint32_t size=0,frames=0;double beats=0;std::memcpy(&size,bytes.data()+16,4);std::memcpy(&frames,bytes.data()+28,4);std::memcpy(&beats,bytes.data()+32,8);
  for(int i=0;i<128;++i){double pos=std::fmod(.125+i*120./(60*48000),beats)/beats*frames;size_t a=size_t(pos)%frames,b=(a+1)%frames;float al,ar,bl,br;
   const auto* pcm=bytes.data()+48+size;std::memcpy(&al,pcm+a*8,4);std::memcpy(&ar,pcm+a*8+4,4);std::memcpy(&bl,pcm+b*8,4);std::memcpy(&br,pcm+b*8+4,4);
   if(std::abs(l[i]-float(al+(bl-al)*(pos-std::floor(pos))))>1e-6||std::abs(r[i]-float(ar+(br-ar)*(pos-std::floor(pos))))>1e-6)ok=false;
  }
  processor->setProcessing(false);clone->setActive(false);processor->release();
 }
 clone->terminate();clone->release();std::cout<<(ok?"PROJECT_STATE_CHECKS_OK":"PROJECT_STATE_CHECKS_FAILED")<<" bytes="<<bytes.size()<<std::endl;return ok;
}
