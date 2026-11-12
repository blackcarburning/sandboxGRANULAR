#include <sstream>
// Test harness only; never shipped in the portable plugin ZIP.
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/gui/iplugview.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/common/memorystream.h"
#include <windows.h>
#include <atomic>
#include <chrono>
#include <cstring>
#include <fstream>
#include <iostream>
#include <thread>
#include <vector>
#ifdef MYGRAIN_CEF_HOST
#include "../cef/ipc.h"
#include "../cef/toolbar.h"
#include <filesystem>
#include <set>
#endif
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
 ProjectDirtyHandler projectDirty;controller->setComponentHandler(&projectDirty);
 ProcessSetup setup{};setup.processMode=kRealtime;setup.symbolicSampleSize=kSample32;setup.maxSamplesPerBlock=128;setup.sampleRate=48000;
 if(processor->setupProcessing(setup)!=kResultOk)return 9;
 component->activateBus(kAudio,kOutput,0,true);component->setActive(true);processor->setProcessing(true);
#ifdef MYGRAIN_CEF_HOST
 std::set<std::filesystem::path> priorDisplays;for(const auto& item:std::filesystem::directory_iterator(std::filesystem::temp_directory_path()))priorDisplays.insert(item.path());
#endif
 HWND parent=CreateWindowExW(0,L"STATIC",L"MYGRAIN Windows DLL test host",WS_OVERLAPPEDWINDOW|WS_VISIBLE,0,0,1270,815,nullptr,nullptr,GetModuleHandle(nullptr),nullptr);
 IPlugView* view=controller->createView(ViewType::kEditor);if(!view||view->attached(parent,kPlatformTypeHWND)!=kResultOk)return 10;
 HWND child=FindWindowExW(parent,nullptr,
#ifdef MYGRAIN_CEF_HOST
 L"MyGrainCEFView010",
#else
 L"MYGRAINBridgeView010",
#endif
 nullptr);if(!child)return 11;
 SetPropW(child,L"audit-original",(HANDLE)SetWindowLongPtrW(child,GWLP_WNDPROC,(LONG_PTR)auditEditor));
 for(int id:{101,102,103,104,105,106}){auto button=GetDlgItem(child,id);SetPropW(button,L"audit-original",(HANDLE)SetWindowLongPtrW(button,GWLP_WNDPROC,(LONG_PTR)auditButton));}
 if(OpenClipboard(parent)){EmptyClipboard();CloseClipboard();}
#ifndef MYGRAIN_CEF_HOST
 SendMessageW(child,WM_COMMAND,102,0);
#endif
 std::atomic<bool> saveProject{false};
 std::atomic<bool> running{true},playing{true},seek{false},offline{false},cycling{false},cycleMetadata{true},reconfigure{false},stateRoundtrip{false};std::atomic<uint64_t> blocks{0};
 const std::string control=std::string(argv[2])+".control";
 std::thread audio([&]{
  std::ofstream file(argv[2],std::ios::binary),positions(std::string(argv[2])+".blocks.csv");positions<<"frame,project,ppq,playing,offline,cycle,frames\n";
  float l[128]{},r[128]{};float* channels[2]{l,r};AudioBusBuffers output{};output.numChannels=2;output.channelBuffers32=channels;
  ProcessContext context{};context.sampleRate=48000;context.tempo=120;context.timeSigNumerator=4;context.timeSigDenominator=4;
  ProcessData data{};data.processMode=kRealtime;data.symbolicSampleSize=kSample32;data.numSamples=128;data.numOutputs=1;data.outputs=&output;data.processContext=&context;
  auto next=std::chrono::steady_clock::now();int64_t project=0;std::vector<char> priorArmedState;
  while(running){
   if(saveProject.exchange(false)){
    MemoryStream saved;if(component->getState(&saved)!=kResultOk){running=false;break;}
    std::ofstream file(std::string(argv[2])+".project.bin",std::ios::binary);file.write(saved.getData(),saved.getSize());file.close();
    if(!checkProjectState(factory,info,host,component,saved)){std::cerr<<"Project state checks failed"<<std::endl;running=false;break;}
    if(!projectDirty.calls.load()||projectDirty.wrongThread.load()){std::cerr<<"Project did not mark host dirty on UI thread"<<std::endl;running=false;break;}
    std::cout<<"PROJECT_DIRTY_UI="<<projectDirty.calls.load()<<" PROJECT_SAVED="<<saved.getSize()<<std::endl;
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
     uint32_t legacy[]{0x3142474d,1};MemoryStream old(legacy,sizeof(legacy));if(component->setState(&old)!=kResultOk){running=false;break;}
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
   context.projectTimeSamples=project;context.projectTimeMusic=project*120./(60*48000);data.processMode=offlineNow?kOffline:kRealtime;
   if(processor->process(data)!=kResultOk){std::cerr<<"Process failed"<<std::endl;running=false;break;}
   positions<<blocks*128<<","<<project<<","<<context.projectTimeMusic<<","<<playNow<<","<<offlineNow<<","<<cycleNow<<",128\n";
   for(int i=0;i<128;++i){file.write((char*)&l[i],4);file.write((char*)&r[i],4);}
   if(playNow){project+=128;if(cycleNow&&project>=96000)project%=96000;}blocks++;next+=std::chrono::nanoseconds(2666667);std::this_thread::sleep_until(next);
  }
 });
 const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(argc>3?std::atoi(argv[3]):50);
 #ifdef MYGRAIN_CEF_HOST
 mygrain::cef::Mapping commandDisplay;
#endif
 bool printed=false;std::string previous;
 while(running&&std::chrono::steady_clock::now()<end){
  MSG message;while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){TranslateMessage(&message);DispatchMessageW(&message);}
#ifdef MYGRAIN_CEF_HOST
  if(!printed){for(const auto& entry:std::filesystem::directory_iterator(std::filesystem::temp_directory_path())){if(priorDisplays.count(entry.path())||entry.path().filename().u8string().rfind("mygrain-cef-",0)!=0)continue;auto& display=commandDisplay;if(display.open((entry.path()/"display.ipc").u8string(),false)){std::string url=display.data->url;auto pos=url.find("#daw=");if(pos!=std::string::npos){std::cout<<url.substr(pos+5)<<std::endl;printed=true;break;}}}}
#else
  if(!printed&&OpenClipboard(parent)){
   if(auto memory=GetClipboardData(CF_UNICODETEXT)){if(auto* text=(const wchar_t*)GlobalLock(memory)){std::wstring wide(text);GlobalUnlock(memory);std::string code(wide.begin(),wide.end());if(code.size()==38&&code.find('.')==5){std::cout<<code<<std::endl;printed=true;}}}CloseClipboard();
  }
#endif
  std::ifstream input(control);std::string cmd,sequence;if(input){std::getline(input,cmd);std::getline(input,sequence);}
  const auto stamp=cmd+"\n"+sequence;if(stamp!=previous){previous=stamp;
#ifdef MYGRAIN_CEF_HOST
  if(cmd=="reopen-editor"&&!view){view=controller->createView(ViewType::kEditor);if(!view||view->attached(parent,kPlatformTypeHWND)!=kResultOk)return 21;child=FindWindowExW(parent,nullptr,L"MyGrainCEFView010",nullptr);}
  if(cmd=="stop-plugin")std::cout<<"CEF_STOPPED=done"<<std::endl;
  if(cmd=="cef-reload")SendMessageW(child,WM_COMMAND,101,0);
  if(cmd=="cef-store"){SendMessageW(GetDlgItem(child,102),BM_CLICK,0,0);std::cout<<"CEF_CONTROL=store"<<std::endl;}
  if(cmd=="cef-auto"){SendMessageW(GetDlgItem(child,220),BM_CLICK,0,0);std::cout<<"CEF_CONTROL=auto"<<std::endl;}
  if(cmd.rfind("cef-interval ",0)==0){const auto text=cmd.substr(13);SetWindowTextW(GetDlgItem(child,221),std::wstring(text.begin(),text.end()).c_str());SendMessageW(GetDlgItem(child,222),BM_CLICK,0,0);std::cout<<"CEF_CONTROL=interval"<<std::endl;}
  if(cmd.rfind("cef-dialog-",0)==0&&commandDisplay.data){
    auto* shared=commandDisplay.data;
    if(cmd=="cef-dialog-state")std::cout<<"CEF_DIALOG="<<shared->dialogKind.load()<<std::endl;
    else{const bool accept=cmd.rfind("cef-dialog-ok ",0)==0;const auto text=accept?cmd.substr(14):std::string();std::memset(shared->dialogInput,0,sizeof(shared->dialogInput));std::memcpy(shared->dialogInput,text.data(),std::min(text.size(),sizeof(shared->dialogInput)-1));commandDisplay.push({mygrain::cef::TestDialog,0,0,accept?1:0});std::cout<<"CEF_DIALOG_REPLY=sent"<<std::endl;}
   }
   if(cmd=="cef-toolbar"){std::cout<<"CEF_TOOLBAR=";for(int id:{106,220,221,230,231}){wchar_t text[2048]{};GetWindowTextW(GetDlgItem(child,id),text,2048);std::wstring wide(text);std::cout<<id<<":"<<std::string(wide.begin(),wide.end())<<"|";}std::cout<<std::endl;}
  if(cmd=="cef-size-small"||cmd=="cef-size-normal"){ViewRect size(0,0,cmd=="cef-size-small"?800:1240,860);view->onSize(&size);RECT last{},client{};GetWindowRect(GetDlgItem(child,222),&last);MapWindowPoints(nullptr,child,(POINT*)&last,2);GetClientRect(child,&client);if(last.right>client.right||last.left<0)return 25;std::cout<<"CEF_SIZE="<<client.right<<std::endl;}
  if(cmd.rfind("cef-host-focus ",0)==0){const bool focus=cmd.back()=='1';if(view->onFocus(focus)!=kResultTrue)return 24;std::cout<<"CEF_FOCUS="<<focus<<std::endl;}
  if(cmd.rfind("cef-host-key ",0)==0){std::istringstream keys(cmd.substr(13));int ch=0,code=0,mod=0;if(keys>>ch>>code>>mod){auto a=view->onKeyDown(char16(ch),code,mod),b=view->onKeyUp(char16(ch),code,mod);std::cout<<"CEF_KEY="<<ch<<":"<<a<<":"<<b<<std::endl;}}
  if(cmd.rfind("cef-native-key ",0)==0){std::istringstream keys(cmd.substr(15));int ch=0,vk=0;if(keys>>ch>>vk){SendMessageW(child,WM_KEYDOWN,vk,0);if(ch)SendMessageW(child,WM_CHAR,ch,0);SendMessageW(child,WM_KEYUP,vk,0);}}

  if(cmd.rfind("cef-click ",0)==0){std::istringstream point(cmd.substr(10));int x=0,y=0;if(point>>x>>y){SetFocus(child);SendMessageW(child,WM_LBUTTONDOWN,MK_LBUTTON,MAKELPARAM(x,y+mygrain::cef::toolbarHeight));SendMessageW(child,WM_LBUTTONUP,0,MAKELPARAM(x,y+mygrain::cef::toolbarHeight));}}
#endif
if(cmd.rfind("remote-pot-drag-",0)==0){const auto from=std::stoul(cmd.substr(16,1)),to=std::stoul(cmd.substr(18,1));auto row=GetDlgItem(child,400+from);SendMessageW(row,WM_LBUTTONDOWN,MK_LBUTTON,MAKELPARAM(20,10));SendMessageW(row,WM_MOUSEMOVE,MK_LBUTTON,MAKELPARAM(20,10+(int(to)-int(from))*35));SendMessageW(row,WM_LBUTTONUP,0,MAKELPARAM(20,10+(int(to)-int(from))*35));}if(cmd=="remote-interval15"){SetWindowTextW(GetDlgItem(child,221),L"15");SendMessageW(child,WM_COMMAND,222,0);}if(cmd.rfind("remote-",0)==0){if(cmd=="remote-status"){std::cout<<"REMOTE_BUTTONS=";for(int id:{201,202,203,204,300,324})std::cout<<id<<":"<<IsWindowEnabled(GetDlgItem(child,id))<<",";std::cout<<std::endl;}unsigned id=0;if(cmd=="remote-sparse")id=201;else if(cmd=="remote-mega")id=202;else if(cmd=="remote-render")id=203;else if(cmd=="remote-store")id=204;else if(cmd=="remote-pot")id=210;else if(cmd=="remote-stir")id=211;else if(cmd=="remote-big-stir")id=212;else if(cmd=="remote-auto")id=220;else if(cmd=="remote-interval")id=222;else if(cmd.rfind("remote-pot-power-",0)==0)id=500+std::stoul(cmd.substr(17));else if(cmd.rfind("remote-pot-up-",0)==0)id=600+std::stoul(cmd.substr(14));else if(cmd.rfind("remote-pot-down-",0)==0)id=700+std::stoul(cmd.substr(16));else if(cmd.rfind("remote-pot-jump-",0)==0)id=400+std::stoul(cmd.substr(16));else if(cmd.rfind("remote-layer-",0)==0)id=300+std::stoul(cmd.substr(13));if(id)SendMessageW(child,WM_COMMAND,id,0);}if(cmd=="close-editor"){if(view){view->removed();view->release();view=nullptr;}}else if(cmd=="save-project")saveProject=true;else if(cmd=="stop")playing=false;else if(cmd=="play")playing=true;else if(cmd=="seek")seek=true;else if(cmd=="rewind"){playing=false;seek=true;}else if(cmd=="loop")cycling=true;else if(cmd=="linear")cycling=false;else if(cmd=="loop-no-metadata"){cycling=true;cycleMetadata=false;}else if(cmd=="cycle-metadata")cycleMetadata=true;else if(cmd=="offline")offline=true;else if(cmd=="offline-setup"){offline=true;reconfigure=true;}else if(cmd=="realtime-setup"||cmd=="routing-change"){offline=false;reconfigure=true;}else if(cmd=="state-roundtrip"){stateRoundtrip=true;reconfigure=true;}else if(cmd=="realtime")offline=false;else if(cmd=="arm-plugin")SendMessageW(child,WM_COMMAND,106,0);else if(cmd=="stop-plugin")SendMessageW(child,WM_COMMAND,104,0);else if(cmd=="play-plugin")SendMessageW(child,WM_COMMAND,103,0);else if(cmd=="screenshot"){

   RECT rect{};GetClientRect(child,&rect);const int width=rect.right,height=rect.bottom;HDC screen=GetDC(child),dc=CreateCompatibleDC(screen);HBITMAP bitmap=CreateCompatibleBitmap(screen,width,height);auto prior=SelectObject(dc,bitmap);BitBlt(dc,0,0,width,height,screen,0,0,SRCCOPY);BITMAPINFO info{};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);info.bmiHeader.biWidth=width;info.bmiHeader.biHeight=-height;info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=BI_RGB;std::vector<char> pixels(size_t(width)*height*4);GetDIBits(dc,bitmap,0,height,pixels.data(),&info,DIB_RGB_COLORS);BITMAPFILEHEADER header{};header.bfType=0x4d42;header.bfOffBits=sizeof(header)+sizeof(info.bmiHeader);header.bfSize=header.bfOffBits+DWORD(pixels.size());std::ofstream image(std::string(argv[2])+".bmp",std::ios::binary);image.write((char*)&header,sizeof(header));image.write((char*)&info.bmiHeader,sizeof(info.bmiHeader));image.write(pixels.data(),pixels.size());SelectObject(dc,prior);DeleteObject(bitmap);DeleteDC(dc);ReleaseDC(child,screen);image.close();std::cout<<"CEF_SCREENSHOT=done"<<std::endl;
  }else if(cmd.rfind("paint-audit",0)==0){std::ofstream audit(std::string(argv[2])+".paint.json");audit<<"{\"full\":"<<fullPaints<<",\"meter\":"<<meterPaints<<",\"buttons\":"<<buttonPaints<<",\"labels\":"<<labelWrites<<"}";}else if(cmd=="quit")break;}
  std::this_thread::sleep_for(std::chrono::milliseconds(10));
 }
 running=false;audio.join();if(view){view->removed();view->release();}DestroyWindow(parent);
 processor->setProcessing(false);component->setActive(false);component->terminate();controller->release();processor->release();component->release();factory->release();exit();FreeLibrary(module);
 std::cout<<"PASS Windows DLL factory, initialize, native editor, processing and unload; blocks="<<blocks<<std::endl;
 return printed?0:12;
}
