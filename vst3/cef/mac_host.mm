#include <sstream>
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
#include "../tests/project_state_checks.h"
#include "ipc.h"
#include "keyboard.h"
#include <filesystem>
#include <set>
static NSButton* button(NSView* view,NSInteger tag){for(NSView* child in view.subviews){if([child isKindOfClass:[NSButton class]]&&child.tag==tag)return (NSButton*)child;if(auto* result=button(child,tag))return result;}return nil;}
int main(int argc,char**argv){@autoreleasepool{
 if(argc<3)return 2;[NSApplication sharedApplication];
 id activity=[[[NSProcessInfo processInfo] beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep|NSActivityLatencyCritical reason:@"Native real-time audio test"] retain];
 NSString* path=[NSString stringWithUTF8String:argv[1]];NSBundle* bundle=[NSBundle bundleWithPath:path];
 void* module=dlopen(bundle.executablePath.fileSystemRepresentation,RTLD_NOW|RTLD_LOCAL);if(!module){std::cerr<<dlerror()<<std::endl;return 3;}
 auto entry=(bool(*)(CFBundleRef))dlsym(module,"bundleEntry");auto exit=(bool(*)())dlsym(module,"bundleExit");auto get=(IPluginFactory*(PLUGIN_API*)())dlsym(module,"GetPluginFactory");
 CFURLRef url=CFURLCreateWithFileSystemPath(nullptr,(CFStringRef)path,kCFURLPOSIXPathStyle,true);CFBundleRef ref=CFBundleCreate(nullptr,url);CFRelease(url);
 if(!entry||!exit||!get||!entry(ref))return 4;
 @autoreleasepool {
 auto* factory=get();PClassInfo info{};if(factory->getClassInfo(0,&info)!=kResultOk)return 5;
 IComponent* component=nullptr;if(factory->createInstance(info.cid,IComponent::iid,(void**)&component)!=kResultOk)return 6;
 HostApplication host;if(component->initialize(&host)!=kResultOk)return 7;
 IAudioProcessor* processor=nullptr;IEditController* controller=nullptr;
 if(component->queryInterface(IAudioProcessor::iid,(void**)&processor)!=kResultOk||component->queryInterface(IEditController::iid,(void**)&controller)!=kResultOk)return 8;
 const bool fx=false;
 if(argc>4){std::ifstream file(argv[4],std::ios::binary);std::vector<char> bytes((std::istreambuf_iterator<char>(file)),{});MemoryStream saved(bytes.data(),bytes.size());if(component->setState(&saved)!=kResultOk)return 20;}
 ProjectDirtyHandler projectDirty;controller->setComponentHandler(&projectDirty);
 ProcessSetup setup{};setup.processMode=kRealtime;setup.symbolicSampleSize=kSample32;setup.maxSamplesPerBlock=128;setup.sampleRate=48000;
 if(processor->setupProcessing(setup)!=kResultOk)return 9;
 if(fx)component->activateBus(kAudio,kInput,0,true);component->activateBus(kAudio,kOutput,0,true);component->setActive(true);processor->setProcessing(true);
 std::set<std::filesystem::path> priorDisplays;for(const auto& item:std::filesystem::directory_iterator(std::filesystem::temp_directory_path()))priorDisplays.insert(item.path());
 NSWindow* window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1240,756) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
 IPlugView* view=controller->createView(ViewType::kEditor);if(!view||view->attached(window.contentView,kPlatformTypeNSView)!=kResultOk)return 10;
 if(!button(window.contentView,102)||!button(window.contentView,106))return 11;
 [window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
 
 std::atomic<bool> playing{true};std::atomic<bool> running{true};std::atomic<int> mode{0};
 std::thread audio([&]{
  std::ofstream file(argv[2],std::ios::binary);float il[128]{},ir[128]{},l[128]{},r[128]{};float* inputs[]{il,ir};float* outputs[]{l,r};
  AudioBusBuffers input{},output{};input.numChannels=output.numChannels=2;input.channelBuffers32=inputs;output.channelBuffers32=outputs;
  ProcessContext context{};context.sampleRate=48000;context.tempo=120;context.timeSigNumerator=4;context.timeSigDenominator=4;
  ProcessData data{};data.symbolicSampleSize=kSample32;data.numSamples=128;data.numInputs=fx?1:0;data.inputs=fx?&input:nullptr;data.numOutputs=1;data.outputs=&output;data.processContext=&context;
  uint64_t frame=0;auto next=std::chrono::steady_clock::now();
  while(running){
   context.state=ProcessContext::kTempoValid|ProcessContext::kProjectTimeMusicValid|ProcessContext::kTimeSigValid|(playing?ProcessContext::kPlaying:0);
   context.projectTimeSamples=frame;context.projectTimeMusic=frame/24000.;data.processMode=mode.load()==1?kOffline:kRealtime;
   for(int i=0;i<128;++i){il[i]=float(.1*std::sin(2*3.141592653589793*173*(frame+i)/48000.));ir[i]=float(.08*std::sin(2*3.141592653589793*317*(frame+i)/48000.));}
   if(processor->process(data)!=kResultOk){running=false;break;}
   for(int i=0;i<128;++i){file.write((char*)&l[i],4);file.write((char*)&r[i],4);}if(playing)frame+=128;
   next+=std::chrono::nanoseconds(2666667);std::this_thread::sleep_until(next);
  }
 });
 bool printed=false;std::string previous;const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(argc>3?std::atoi(argv[3]):300);
 while(running&&std::chrono::steady_clock::now()<deadline){@autoreleasepool{
  [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.02]];
  if(!printed){for(const auto& item:std::filesystem::directory_iterator(std::filesystem::temp_directory_path())){if(priorDisplays.count(item.path())||item.path().filename().u8string().rfind("mygrain-cef-",0)!=0)continue;mygrain::cef::Mapping display;if(display.open((item.path()/"display.ipc").u8string(),false)){std::string url=display.data->url;auto pos=url.find("#daw=");if(pos!=std::string::npos){std::cout<<"CODE="<<url.substr(pos+5)<<std::endl;printed=true;break;}}}}

  std::ifstream control(std::string(argv[2])+".control");std::string command;std::getline(control,command);
  if(command!=previous){previous=command;
   if(command=="quit")break;
   if(command=="arm-plugin")[button(window.contentView,106) performClick:nil];
   if(command=="stop-plugin")[button(window.contentView,104) performClick:nil];
   if(command=="cef-reload")[button(window.contentView,101) performClick:nil];
   if(command=="cef-store")[button(window.contentView,102) performClick:nil];
   if(command.rfind("cef-host-focus ",0)==0){const bool focused=command.back()=='1';if(view->onFocus(focused)!=kResultTrue)return 24;std::cout<<"CEF_FOCUS="<<focused<<std::endl;}
   if(command.rfind("cef-host-key ",0)==0){std::istringstream keys(command.substr(13));int ch=0,code=0,mod=0;if(keys>>ch>>code>>mod){auto a=view->onKeyDown(char16(ch),code,mod),b=view->onKeyUp(char16(ch),code,mod);std::cout<<"CEF_KEY="<<ch<<":"<<a<<":"<<b<<std::endl;}}
   if(command.rfind("cef-native-key ",0)==0){std::istringstream keys(command.substr(15));int ch=0,vk=0;if(keys>>ch>>vk){NSView* surface=window.contentView.subviews.firstObject;unichar c=ch;NSString* text=[NSString stringWithCharacters:&c length:ch?1:0];for(NSEventType type:{NSEventTypeKeyDown,NSEventTypeKeyUp}){NSEvent* event=[NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber context:nil characters:text charactersIgnoringModifiers:text isARepeat:NO keyCode:mygrain::cef::nativeKey(vk)];if(type==NSEventTypeKeyDown)[surface keyDown:event];else [surface keyUp:event];}}}

   if(command.rfind("cef-click ",0)==0){std::istringstream point(command.substr(10));int x=0,y=0;if(point>>x>>y){NSView* surface=window.contentView.subviews.firstObject;NSPoint location=[surface convertPoint:NSMakePoint(x,y+68) toView:nil];for(NSEventType type:{NSEventTypeLeftMouseDown,NSEventTypeLeftMouseUp}){NSEvent* event=[NSEvent mouseEventWithType:type location:location modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];if(type==NSEventTypeLeftMouseDown)[surface mouseDown:event];else [surface mouseUp:event];}}}
   if(command=="play")playing=true;if(command=="stop")playing=false;
   if(command=="close-editor"&&view){view->removed();view->release();view=nullptr;}
   if(command=="reopen-editor"&&!view){view=controller->createView(ViewType::kEditor);if(!view||view->attached(window.contentView,kPlatformTypeNSView)!=kResultOk)std::abort();}
   if(command=="save-project"){MemoryStream state;if(component->getState(&state)!=kResultOk||!checkProjectState(factory,info,host,component,state))std::abort();std::ofstream saved(std::string(argv[2])+".project.bin",std::ios::binary);saved.write(state.getData(),state.getSize());saved.close();std::cout<<"PROJECT_DIRTY_UI="<<projectDirty.calls.load()<<" PROJECT_SAVED="<<state.getSize()<<std::endl;}
   if(command=="screenshot"){
    auto* bitmap=[window.contentView bitmapImageRepForCachingDisplayInRect:window.contentView.bounds];[window.contentView cacheDisplayInRect:window.contentView.bounds toBitmapImageRep:bitmap];
    [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[NSString stringWithUTF8String:(std::string(argv[2])+".png").c_str()] atomically:YES];
   }
  }
 }}
 running=false;audio.join();
 // Restoring an unedited DAW state must not mark a fresh instance dirty.
 if(projectDirty.wrongThread.load()||(!projectDirty.calls.load()&&argc<=4))return 15;
 std::cout<<"PROJECT_DIRTY_UI="<<projectDirty.calls.load()<<std::endl;
 MemoryStream state;if(component->getState(&state)!=kResultOk||state.getSize()<48)return 12;state.seek(0,IBStream::kIBSeekSet,nullptr);if(component->setState(&state)!=kResultOk)return 13;
 if(!checkProjectState(factory,info,host,component,state))return 14;
 std::cout<<"LATENCY="<<processor->getLatencySamples()<<" STATE_BYTES="<<state.getSize()<<std::endl;
 if(view){view->removed();view->release();}[window release];processor->setProcessing(false);component->setActive(false);controller->release();processor->release();component->terminate();component->release();factory->release();
 } // Drain AppKit event autoreleases before unloading Objective-C class code.
 exit();CFRelease(ref);dlclose(module);
 [[NSProcessInfo processInfo] endActivity:activity];[activity release];std::cout<<"NATIVE_HOST_OK"<<std::endl;return 0;
}}
