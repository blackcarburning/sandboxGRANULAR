// Test harness only; never shipped in the portable plugin ZIP.
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/gui/iplugview.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/common/memorystream.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include <windows.h>
#include <atomic>
#include <chrono>
#include <cstring>
#include <cmath>
#include <fstream>
#include <iostream>
#include <thread>
#include <vector>
using namespace Steinberg;using namespace Steinberg::Vst;
#include "project_state_checks.h"
static uint64_t fullPaints=0,meterPaints=0,buttonPaints=0,labelWrites=0;
static LRESULT CALLBACK auditEditor(HWND w,UINT message,WPARAM wp,LPARAM lp){
 if(message==WM_PAINT){RECT rect{};GetUpdateRect(w,&rect,FALSE);if((rect.right-rect.left)*(rect.bottom-rect.top)>10000)fullPaints++;else meterPaints++;}
 if(message==WM_DRAWITEM)buttonPaints++;
 return CallWindowProcW((WNDPROC)GetPropW(w,L"audit-original"),w,message,wp,lp);
}
static LRESULT CALLBACK auditButton(HWND w,UINT message,WPARAM wp,LPARAM lp){
 if(message==WM_SETTEXT)labelWrites++;
 return CallWindowProcW((WNDPROC)GetPropW(w,L"audit-original"),w,message,wp,lp);
}

int main(int argc,char**argv){
 if(argc<3)return 2;
 HMODULE module=LoadLibraryA(argv[1]);if(!module){std::cerr<<"LoadLibrary "<<GetLastError()<<std::endl;return 3;}
 auto init=(bool(*)())GetProcAddress(module,"InitDll"),exit=(bool(*)())GetProcAddress(module,"ExitDll");
 auto get=(IPluginFactory*(PLUGIN_API*)())GetProcAddress(module,"GetPluginFactory");if(!get||!init||!exit||!init())return 4;
 auto* factory=get();PClassInfo info{};if(factory->getClassInfo(0,&info)!=kResultOk)return 5;
 IComponent* component=nullptr;if(factory->createInstance(info.cid,IComponent::iid,(void**)&component)!=kResultOk)return 6;
 HostApplication host;if(component->initialize(&host)!=kResultOk)return 7;
 IAudioProcessor* processor=nullptr;IEditController* controller=nullptr;
 if(component->queryInterface(IAudioProcessor::iid,(void**)&processor)!=kResultOk||component->queryInterface(IEditController::iid,(void**)&controller)!=kResultOk)return 8;
 if(argc>4){std::ifstream file(argv[4],std::ios::binary);std::vector<char> bytes((std::istreambuf_iterator<char>(file)),{});MemoryStream saved(bytes.data(),bytes.size());if(component->setState(&saved)!=kResultOk)return 20;}
 ProcessSetup setup{};setup.processMode=kRealtime;setup.symbolicSampleSize=kSample32;setup.maxSamplesPerBlock=128;setup.sampleRate=48000;
 if(processor->setupProcessing(setup)!=kResultOk)return 9;
 component->activateBus(kAudio,kInput,0,true);std::cout<<"LATENCY="<<processor->getLatencySamples()<<std::endl;
 component->activateBus(kAudio,kOutput,0,true);component->setActive(true);processor->setProcessing(true);
 HWND parent=CreateWindowExW(0,L"STATIC",L"MYGRAIN Windows DLL test host",WS_OVERLAPPEDWINDOW|WS_VISIBLE,0,0,810,610,nullptr,nullptr,GetModuleHandle(nullptr),nullptr);
 IPlugView* view=controller->createView(ViewType::kEditor);if(!view||view->attached(parent,kPlatformTypeHWND)!=kResultOk)return 10;
 HWND child=FindWindowExW(parent,nullptr,L"MYGRAINFXView010",nullptr);if(!child)return 11;
 SetPropW(child,L"audit-original",(HANDLE)SetWindowLongPtrW(child,GWLP_WNDPROC,(LONG_PTR)auditEditor));
 for(int id:{101,102,103,104,105,106}){auto button=GetDlgItem(child,id);SetPropW(button,L"audit-original",(HANDLE)SetWindowLongPtrW(button,GWLP_WNDPROC,(LONG_PTR)auditButton));}
 SendMessageW(child,WM_COMMAND,102,0);
 std::atomic<bool> bypass{false},silentInput{false};
 std::atomic<bool> saveProject{false};
 std::atomic<bool> running{true},playing{true},seek{false},offline{false},cycling{false},cycleMetadata{true},reconfigure{false},stateRoundtrip{false};std::atomic<uint64_t> blocks{0};std::atomic<double> tempo{120};
 const std::string control=std::string(argv[2])+".control";
 std::thread audio([&]{
  std::ofstream file(argv[2],std::ios::binary),positions(std::string(argv[2])+".blocks.csv");positions<<"frame,project,ppq,playing,offline,cycle,frames\n";
  float il[128]{},ir[128]{};float* inputChannels[2]{il,ir};AudioBusBuffers inputBus{};inputBus.numChannels=2;inputBus.channelBuffers32=inputChannels;
  float l[128]{},r[128]{};float* channels[2]{l,r};AudioBusBuffers output{};output.numChannels=2;output.channelBuffers32=channels;
  ProcessContext context{};context.sampleRate=48000;context.tempo=120;context.timeSigNumerator=4;context.timeSigDenominator=4;
  ProcessData data{};data.processMode=kRealtime;data.symbolicSampleSize=kSample32;data.numSamples=128;data.numInputs=1;data.inputs=&inputBus;data.numOutputs=1;data.outputs=&output;data.processContext=&context;
  ParameterChanges parameterChanges(1);
  auto next=std::chrono::steady_clock::now();int64_t project=0;std::vector<char> priorArmedState;
  while(running){
   if(saveProject.exchange(false)){
    MemoryStream saved;if(component->getState(&saved)!=kResultOk){running=false;break;}
    std::ofstream file(std::string(argv[2])+".project.bin",std::ios::binary);file.write(saved.getData(),saved.getSize());file.close();
    if(!checkProjectState(factory,info,host,component,saved)){std::cerr<<"Project state checks failed"<<std::endl;running=false;break;}
    std::cout<<"PROJECT_SAVED="<<saved.getSize()<<std::endl;
   }
   if(seek.exchange(false))project=0;
   const bool playNow=playing.load(),cycleNow=cycling.load(),metadataNow=cycleMetadata.load(),offlineNow=offline.load();
   if(reconfigure.exchange(false)){
    processor->setProcessing(false);component->setActive(false);
    if(stateRoundtrip.exchange(false)){
     MemoryStream saved;if(component->getState(&saved)!=kResultOk||saved.getSize()<48){running=false;break;}
     const uint32_t flags=*(uint32_t*)(saved.getData()+8);
     if(flags&1u)priorArmedState.assign(saved.getData(),saved.getData()+saved.getSize());
     std::ofstream stateFile(std::string(argv[2])+".state.bin",std::ios::binary);stateFile.write(saved.getData(),saved.getSize());saved.seek(0,IBStream::kIBSeekSet,nullptr);
     if(component->setState(&saved)!=kResultOk){running=false;break;}

     if(!flags&&!priorArmedState.empty()){
      MemoryStream stale(priorArmedState.data(),priorArmedState.size());component->setState(&stale);MemoryStream observed;component->getState(&observed);
      if(observed.getSize()<48||*(uint32_t*)(observed.getData()+8)!=0){std::cerr<<"Stale state overrode explicit Stop"<<std::endl;running=false;break;}
     }
     IComponent* clone=nullptr;
     if(factory->createInstance(info.cid,IComponent::iid,(void**)&clone)!=kResultOk||clone->initialize(&host)!=kResultOk){running=false;break;}
     MemoryStream restore(saved.getData(),saved.getSize());const auto restored=clone->setState(&restore);MemoryStream observed;clone->getState(&observed);const bool matches=restored==kResultOk&&observed.getSize()==saved.getSize()&&std::memcmp(observed.getData(),saved.getData(),saved.getSize())==0;clone->terminate();clone->release();
     if(!matches){std::cerr<<"Fresh state restore mismatch"<<std::endl;running=false;break;}
    }
    setup.processMode=offlineNow?kOffline:kRealtime;
    if(processor->setupProcessing(setup)!=kResultOk){running=false;break;}
    component->setActive(true);processor->setProcessing(true);
   }
   context.state=ProcessContext::kTempoValid|ProcessContext::kProjectTimeMusicValid|ProcessContext::kTimeSigValid|(metadataNow?ProcessContext::kCycleValid:0)|(playNow?ProcessContext::kPlaying:0)|(cycleNow&&metadataNow?ProcessContext::kCycleActive:0);
   context.cycleStartMusic=0;context.cycleEndMusic=4;
   context.tempo=tempo.load();context.projectTimeSamples=project;context.projectTimeMusic=project*context.tempo/(60*48000);data.processMode=offlineNow?kOffline:kRealtime;
   for(int i=0;i<128;i++){const double t=(blocks.load()*128+i)/48000.;il[i]=float(.1*std::sin(2*3.141592653589793*173*t)+((blocks.load()*128+i)%48000==12345?.2:0));ir[i]=float(.08*std::sin(2*3.141592653589793*317*t));}
   inputBus.silenceFlags=silentInput.load()?3:0;
   parameterChanges.clearQueue();int32 paramIndex=0,pointIndex=0;auto* queue=parameterChanges.addParameterData(100,paramIndex);queue->addPoint(0,bypass.load()?1:0,pointIndex);data.inputParameterChanges=&parameterChanges;
   if(processor->process(data)!=kResultOk){std::cerr<<"Process failed"<<std::endl;running=false;break;}
   positions<<blocks*128<<","<<project<<","<<context.projectTimeMusic<<","<<playNow<<","<<offlineNow<<","<<cycleNow<<",128\n";
   for(int i=0;i<128;++i){file.write((char*)&l[i],4);file.write((char*)&r[i],4);}
   if(playNow){project+=128;if(cycleNow&&project>=96000)project%=96000;}blocks++;next+=std::chrono::nanoseconds(2666667);std::this_thread::sleep_until(next);
  }
 });
 const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(argc>3?std::atoi(argv[3]):50);
 bool printed=false;std::string previous;
 while(running&&std::chrono::steady_clock::now()<end){
  MSG message;while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){TranslateMessage(&message);DispatchMessageW(&message);}
  if(!printed&&OpenClipboard(parent)){
   if(auto memory=GetClipboardData(CF_UNICODETEXT)){if(auto* text=(const wchar_t*)GlobalLock(memory)){std::wstring wide(text);GlobalUnlock(memory);std::string code(wide.begin(),wide.end());if(code.size()==38&&code.find('.')==5){std::cout<<code<<std::endl;printed=true;}}}CloseClipboard();
  }
  std::ifstream input(control);std::string cmd;if(input)std::getline(input,cmd);
  if(cmd!=previous){previous=cmd;if(cmd=="save-project")saveProject=true;else if(cmd=="tempo90")tempo=90;else if(cmd=="tempo121.5")tempo=121.5;else if(cmd=="tempo120")tempo=120;else if(cmd=="silence")silentInput=true;else if(cmd=="input")silentInput=false;else if(cmd=="bypass"){bypass=true;controller->setParamNormalized(100,1);}else if(cmd=="wet"){bypass=false;controller->setParamNormalized(100,0);}else if(cmd=="stop")playing=false;else if(cmd=="play")playing=true;else if(cmd=="seek")seek=true;else if(cmd=="rewind"){playing=false;seek=true;}else if(cmd=="loop")cycling=true;else if(cmd=="linear")cycling=false;else if(cmd=="loop-no-metadata"){cycling=true;cycleMetadata=false;}else if(cmd=="cycle-metadata")cycleMetadata=true;else if(cmd=="offline")offline=true;else if(cmd=="offline-setup"){offline=true;reconfigure=true;}else if(cmd=="realtime-setup"||cmd=="routing-change"){offline=false;reconfigure=true;}else if(cmd=="state-roundtrip"){stateRoundtrip=true;reconfigure=true;}else if(cmd=="realtime")offline=false;else if(cmd=="arm-plugin")SendMessageW(child,WM_COMMAND,106,0);else if(cmd=="stop-plugin")SendMessageW(child,WM_COMMAND,104,0);else if(cmd=="play-plugin")SendMessageW(child,WM_COMMAND,103,0);else if(cmd=="screenshot"){
   RECT rect{};GetClientRect(child,&rect);const int width=rect.right,height=rect.bottom;HDC screen=GetDC(child),dc=CreateCompatibleDC(screen);HBITMAP bitmap=CreateCompatibleBitmap(screen,width,height);auto prior=SelectObject(dc,bitmap);BitBlt(dc,0,0,width,height,screen,0,0,SRCCOPY);BITMAPINFO info{};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);info.bmiHeader.biWidth=width;info.bmiHeader.biHeight=-height;info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=BI_RGB;std::vector<char> pixels(size_t(width)*height*4);GetDIBits(dc,bitmap,0,height,pixels.data(),&info,DIB_RGB_COLORS);BITMAPFILEHEADER header{};header.bfType=0x4d42;header.bfOffBits=sizeof(header)+sizeof(info.bmiHeader);header.bfSize=header.bfOffBits+DWORD(pixels.size());std::ofstream image(std::string(argv[2])+".bmp",std::ios::binary);image.write((char*)&header,sizeof(header));image.write((char*)&info.bmiHeader,sizeof(info.bmiHeader));image.write(pixels.data(),pixels.size());SelectObject(dc,prior);DeleteObject(bitmap);DeleteDC(dc);ReleaseDC(child,screen);
  }else if(cmd.rfind("paint-audit",0)==0){std::ofstream audit(std::string(argv[2])+".paint.json");audit<<"{\"full\":"<<fullPaints<<",\"meter\":"<<meterPaints<<",\"buttons\":"<<buttonPaints<<",\"labels\":"<<labelWrites<<"}";}else if(cmd=="quit")break;}
  std::this_thread::sleep_for(std::chrono::milliseconds(10));
 }
 running=false;audio.join();view->removed();view->release();DestroyWindow(parent);
 processor->setProcessing(false);component->setActive(false);component->terminate();controller->release();processor->release();component->release();factory->release();exit();FreeLibrary(module);
 std::cout<<"PASS Windows DLL factory, initialize, native editor, processing and unload; blocks="<<blocks<<std::endl;
 return printed?0:12;
}
