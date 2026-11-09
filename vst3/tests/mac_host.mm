// Native macOS integration harness; excluded from release bundles.
#import <Cocoa/Cocoa.h>
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/gui/iplugview.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/common/memorystream.h"
#include <dlfcn.h>
#include <atomic>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iostream>
#include <thread>
using namespace Steinberg;using namespace Steinberg::Vst;
static NSButton* button(NSView* view,NSInteger tag){for(NSView* child in view.subviews){if([child isKindOfClass:[NSButton class]]&&child.tag==tag)return (NSButton*)child;if(auto* result=button(child,tag))return result;}return nil;}
int main(int argc,char**argv){@autoreleasepool{
 if(argc<3)return 2;[NSApplication sharedApplication];
 NSString* path=[NSString stringWithUTF8String:argv[1]];NSBundle* bundle=[NSBundle bundleWithPath:path];
 void* module=dlopen(bundle.executablePath.fileSystemRepresentation,RTLD_NOW|RTLD_LOCAL);if(!module){std::cerr<<dlerror()<<std::endl;return 3;}
 auto entry=(bool(*)(CFBundleRef))dlsym(module,"bundleEntry");auto exit=(bool(*)())dlsym(module,"bundleExit");auto get=(IPluginFactory*(PLUGIN_API*)())dlsym(module,"GetPluginFactory");
 CFURLRef url=CFURLCreateWithFileSystemPath(nullptr,(CFStringRef)path,kCFURLPOSIXPathStyle,true);CFBundleRef ref=CFBundleCreate(nullptr,url);CFRelease(url);
 if(!entry||!exit||!get||!entry(ref))return 4;
 auto* factory=get();PClassInfo info{};if(factory->getClassInfo(0,&info)!=kResultOk)return 5;
 IComponent* component=nullptr;if(factory->createInstance(info.cid,IComponent::iid,(void**)&component)!=kResultOk)return 6;
 HostApplication host;if(component->initialize(&host)!=kResultOk)return 7;
 IAudioProcessor* processor=nullptr;IEditController* controller=nullptr;
 if(component->queryInterface(IAudioProcessor::iid,(void**)&processor)!=kResultOk||component->queryInterface(IEditController::iid,(void**)&controller)!=kResultOk)return 8;
 const bool fx=component->getBusCount(kAudio,kInput)==1;
 ProcessSetup setup{};setup.processMode=kRealtime;setup.symbolicSampleSize=kSample32;setup.maxSamplesPerBlock=128;setup.sampleRate=48000;
 if(processor->setupProcessing(setup)!=kResultOk)return 9;
 if(fx)component->activateBus(kAudio,kInput,0,true);component->activateBus(kAudio,kOutput,0,true);component->setActive(true);processor->setProcessing(true);
 NSWindow* window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,780,552) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
 IPlugView* view=controller->createView(ViewType::kEditor);if(!view||view->attached(window.contentView,kPlatformTypeNSView)!=kResultOk)return 10;
 if(!button(window.contentView,102)||!button(window.contentView,106))return 11;
 [button(window.contentView,102) performClick:nil];
 std::atomic<bool> running{true};std::atomic<int> mode{0};
 std::thread audio([&]{
  std::ofstream file(argv[2],std::ios::binary);float il[128]{},ir[128]{},l[128]{},r[128]{};float* inputs[]{il,ir};float* outputs[]{l,r};
  AudioBusBuffers input{},output{};input.numChannels=output.numChannels=2;input.channelBuffers32=inputs;output.channelBuffers32=outputs;
  ProcessContext context{};context.sampleRate=48000;context.tempo=120;context.timeSigNumerator=4;context.timeSigDenominator=4;
  ProcessData data{};data.symbolicSampleSize=kSample32;data.numSamples=128;data.numInputs=fx?1:0;data.inputs=fx?&input:nullptr;data.numOutputs=1;data.outputs=&output;data.processContext=&context;
  uint64_t frame=0;auto next=std::chrono::steady_clock::now();
  while(running){
   context.state=ProcessContext::kTempoValid|ProcessContext::kProjectTimeMusicValid|ProcessContext::kTimeSigValid|ProcessContext::kPlaying;
   context.projectTimeSamples=frame;context.projectTimeMusic=frame/24000.;data.processMode=mode.load()==1?kOffline:kRealtime;
   for(int i=0;i<128;++i){il[i]=float(.1*std::sin(2*3.141592653589793*173*(frame+i)/48000.));ir[i]=float(.08*std::sin(2*3.141592653589793*317*(frame+i)/48000.));}
   if(processor->process(data)!=kResultOk){running=false;break;}
   for(int i=0;i<128;++i){file.write((char*)&l[i],4);file.write((char*)&r[i],4);}frame+=128;
   next+=std::chrono::nanoseconds(2666667);std::this_thread::sleep_until(next);
  }
 });
 bool printed=false;std::string previous;const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(35);
 while(running&&std::chrono::steady_clock::now()<deadline){@autoreleasepool{
  [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.02]];
  if(!printed){NSString* code=[[NSPasteboard generalPasteboard] stringForType:NSPasteboardTypeString];if(code.length==38){std::cout<<"CODE="<<code.UTF8String<<std::endl;printed=true;}}
  std::ifstream control(std::string(argv[2])+".control");std::string command;std::getline(control,command);
  if(command!=previous){previous=command;
   if(command=="quit")break;
   if(command=="arm")[button(window.contentView,106) performClick:nil];
   if(command=="stop")[button(window.contentView,104) performClick:nil];
   if(command=="disconnect")[button(window.contentView,105) performClick:nil];
   if(command=="offline")mode=1;if(command=="realtime")mode=0;
   if(command=="reopen"){view->removed();view->release();view=controller->createView(ViewType::kEditor);if(!view||view->attached(window.contentView,kPlatformTypeNSView)!=kResultOk)std::abort();}
   if(command=="screenshot"){
    auto* bitmap=[window.contentView bitmapImageRepForCachingDisplayInRect:window.contentView.bounds];[window.contentView cacheDisplayInRect:window.contentView.bounds toBitmapImageRep:bitmap];
    [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[NSString stringWithUTF8String:(std::string(argv[2])+".png").c_str()] atomically:YES];
   }
  }
 }}
 running=false;audio.join();
 MemoryStream state;if(component->getState(&state)!=kResultOk||state.getSize()!=(fx?16:12))return 12;state.seek(0,IBStream::kIBSeekSet,nullptr);if(component->setState(&state)!=kResultOk)return 13;
 std::cout<<"LATENCY="<<processor->getLatencySamples()<<" STATE_BYTES="<<state.getSize()<<std::endl;
 view->removed();view->release();[window release];processor->setProcessing(false);component->setActive(false);controller->release();processor->release();component->terminate();component->release();factory->release();exit();CFRelease(ref);dlclose(module);
 std::cout<<"NATIVE_HOST_OK"<<std::endl;return 0;
}}
