// The ONLY executable that initializes CEF. The DAW plugin never loads libcef.
#include "ipc.h"
#include "fx_clock.h"
#include "include/capi/cef_app_capi.h"
#include "include/capi/cef_client_capi.h"
#include "include/capi/cef_render_handler_capi.h"
#include "include/capi/cef_life_span_handler_capi.h"
#include "include/capi/cef_load_handler_capi.h"
#include "include/capi/cef_permission_handler_capi.h"
#include "include/capi/cef_download_handler_capi.h"
#include "include/capi/cef_frame_capi.h"
#include "include/capi/cef_render_process_handler_capi.h"
#include "include/capi/cef_process_message_capi.h"
#include "include/capi/cef_jsdialog_handler_capi.h"
#include "include/capi/cef_cookie_capi.h"
#include "include/cef_api_hash.h"
#include <filesystem>
#include <chrono>
#include <thread>
#include <iostream>
#include <iomanip>
#include <fstream>
#include <sstream>
#ifdef _WIN32
#include <shellapi.h>
#include <shlobj.h>
#include <wincrypt.h>
#endif
#ifndef _WIN32
#include <signal.h>
#endif
#ifdef __APPLE__
#import <Cocoa/Cocoa.h>
#import "include/cef_application_mac.h"
@interface MyGrainCEFApplication : NSApplication<CefAppProtocol> {BOOL handling_;}
@end
@implementation MyGrainCEFApplication
- (BOOL)isHandlingSendEvent{return handling_;}
- (void)setHandlingSendEvent:(BOOL)value{handling_=value;}
- (void)sendEvent:(NSEvent*)event{BOOL prior=handling_;handling_=YES;[super sendEvent:event];handling_=prior;}
@end
@interface MyGrainDialogAction : NSObject
- (void)accept:(id)sender;
- (void)cancel:(id)sender;
@end
#endif
namespace {
using namespace mygrain::cef;
Mapping mapping;
cef_browser_t* browser=nullptr;bool closed=false;
std::string target;
bool diagnosticInput=false;int audioChannels=2;
std::vector<uint8_t> mainPixels,popupPixels;uint32_t mainWidth=0,mainHeight=0;cef_rect_t popupRect{};bool popupVisible=false;
void publish(){
 if(mainPixels.empty())return;
 if(!popupVisible||popupPixels.empty()){mapping.paint(mainPixels.data(),mainWidth,mainHeight);return;}
 auto display=mainPixels;
 for(int y=0;y<popupRect.height;y++){int dy=y+popupRect.y;if(dy<0||dy>=int(mainHeight))continue;int left=std::max(0,popupRect.x),right=std::min(int(mainWidth),popupRect.x+popupRect.width);if(right>left)std::memcpy(display.data()+(size_t(dy)*mainWidth+left)*4,popupPixels.data()+(size_t(y)*popupRect.width+left-popupRect.x)*4,size_t(right-left)*4);}
 mapping.paint(display.data(),mainWidth,mainHeight);
}
template<class T>struct Object {
 T api{};std::atomic<int> refs{1};
 Object(){api.base.size=sizeof(T);api.base.add_ref=[](cef_base_ref_counted_t* b){((Object*)b)->refs.fetch_add(1);};api.base.release=[](cef_base_ref_counted_t* b)->int{((Object*)b)->refs.fetch_sub(1);return 0;};api.base.has_one_ref=[](cef_base_ref_counted_t* b)->int{return ((Object*)b)->refs.load()==1;};api.base.has_at_least_one_ref=[](cef_base_ref_counted_t* b)->int{return ((Object*)b)->refs.load()>0;};}
 T* get(){api.base.add_ref(&api.base);return &api;}
}; // All callback objects live until cef_shutdown; CEF never deletes static storage.
struct String {
 cef_string_t value{};explicit String(const std::string& s){cef_string_utf8_to_utf16(s.data(),s.size(),&value);}~String(){cef_string_utf16_clear(&value);}operator const cef_string_t*()const{return &value;}
};
std::string utf8(const cef_string_t* value){if(!value)return {};cef_string_utf8_t s{};cef_string_utf16_to_utf8(value->str,value->length,&s);std::string out(s.str,s.length);cef_string_utf8_clear(&s);return out;}
std::string quote(const std::string& s){std::string o="\"";for(unsigned char c:s){if(c=='"'||c=='\\')o+='\\';if(c>=32)o+=char(c);}return o+'"';}
std::string pathString(const std::filesystem::path& p){const auto value=p.u8string();return std::string(value.begin(),value.end());}
void script(const std::string& s){auto* f=browser->get_main_frame(browser);if(f){String code(s),origin("https://openclaw.blackcarburning.com/mygrain/");f->execute_java_script(f,code,origin,0);f->base.release(&f->base);}}
Object<cef_app_t> app;
Object<cef_client_t> client;
Object<cef_render_handler_t> render;
Object<cef_render_process_handler_t> renderer;
Object<cef_life_span_handler_t> life;
Object<cef_load_handler_t> load;
Object<cef_permission_handler_t> permissions;
Object<cef_download_handler_t> downloads;
#include "login.h"
#include "dialogs.h"
Object<cef_jsdialog_handler_t> dialogs;
Object<cef_audio_handler_t> audio;
Object<cef_completion_callback_t> cookieReady;
Object<cef_set_cookie_callback_t> cookieSet;
void setup(){
 app.api.get_render_process_handler=[](cef_app_t*){return renderer.get();};
 renderer.api.on_focused_node_changed=[](cef_render_process_handler_t*,cef_browser_t*,cef_frame_t* frame,cef_domnode_t* node){
  if(!frame)return;String name("mygrain-text-editing");auto* message=cef_process_message_create(name);
  auto* args=message->get_argument_list(message);args->set_bool(args,0,node&&node->is_editable(node));args->base.release(&args->base);
  // C API send transfers ownership and invalidates the message reference.
  frame->send_process_message(frame,PID_BROWSER,message);
 };
 client.api.on_process_message_received=[](cef_client_t*,cef_browser_t*,cef_frame_t*,cef_process_id_t source,cef_process_message_t* message)->int{
  auto* name=message->get_name(message);const bool ours=source==PID_RENDERER&&utf8(name)=="mygrain-text-editing";cef_string_userfree_utf16_free(name);
  if(!ours)return 0;auto* args=message->get_argument_list(message);if(mapping.data)mapping.data->textEditing.store(args->get_bool(args,0)?1:0,std::memory_order_release);args->base.release(&args->base);return 1;
 };
 load.api.on_load_start=[](cef_load_handler_t*,cef_browser_t*,cef_frame_t* frame,cef_transition_type_t){if(frame->is_main(frame)&&mapping.data)mapping.data->textEditing.store(0,std::memory_order_release);};
 app.api.on_before_command_line_processing=[](cef_app_t*,const cef_string_t*,cef_command_line_t* cmd){
  // Closing a DAW editor is not permission to suspend audio or the auto-store timer.
  for(const auto* s:{"disable-background-timer-throttling","disable-renderer-backgrounding","disable-backgrounding-occluded-windows","disable-gpu","disable-gpu-compositing","disable-pinch"}){String v(s);cmd->append_switch(cmd,v);}
  String key("autoplay-policy"),value("no-user-gesture-required");cmd->append_switch_with_value(cmd,key,value);
 };
 client.api.get_render_handler=[](cef_client_t*){return render.get();};
 client.api.get_life_span_handler=[](cef_client_t*){return life.get();};
 client.api.get_load_handler=[](cef_client_t*){return load.get();};
 client.api.get_permission_handler=[](cef_client_t*){return permissions.get();};
 client.api.get_download_handler=[](cef_client_t*){return downloads.get();};
 client.api.get_jsdialog_handler=[](cef_client_t*){return dialogs.get();};
 client.api.get_audio_handler=[](cef_client_t*){return audio.get();};
 audio.api.get_audio_parameters=[](cef_audio_handler_t*,cef_browser_t*,cef_audio_parameters_t* params)->int{params->channel_layout=CEF_CHANNEL_LAYOUT_STEREO;params->sample_rate=48000;params->frames_per_buffer=480;return 1;};
 audio.api.on_audio_stream_started=[](cef_audio_handler_t*,cef_browser_t*,const cef_audio_parameters_t* params,int channels){audioChannels=channels;mapping.data->preview.rate.store(params->sample_rate,std::memory_order_release);};
 audio.api.on_audio_stream_packet=[](cef_audio_handler_t*,cef_browser_t*,const float** data,int frames,int64_t){mapping.data->preview.push(data,audioChannels,frames);};
 audio.api.on_audio_stream_stopped=[](cef_audio_handler_t*,cef_browser_t*){};
 audio.api.on_audio_stream_error=[](cef_audio_handler_t*,cef_browser_t*,const cef_string_t*){mapping.data->status.store(7);};
 dialogs.api.on_jsdialog=[](cef_jsdialog_handler_t*,cef_browser_t*,const cef_string_t* origin,cef_jsdialog_type_t type,const cef_string_t* message,const cef_string_t* initial,cef_jsdialog_callback_t* callback,int* suppress)->int{
  if(utf8(origin).rfind("https://openclaw.blackcarburning.com/",0)!=0){*suppress=1;return 0;}
  showDialog(type,utf8(message),utf8(initial),callback);return 1;
 };
 dialogs.api.on_reset_dialog_state=[](cef_jsdialog_handler_t*,cef_browser_t*){if(dialogCallback)dismissDialog(false,false);};
 render.api.get_view_rect=[](cef_render_handler_t*,cef_browser_t*,cef_rect_t* rect){rect->x=rect->y=0;rect->width=mapping.data->width.load();rect->height=mapping.data->height.load();};
 render.api.on_paint=[](cef_render_handler_t*,cef_browser_t*,cef_paint_element_type_t type,size_t,const cef_rect_t*,const void* buffer,int width,int height){
  if(width<1||height<1||width>int(maxWidth)||height>int(maxHeight))return;
  const auto* bytes=(const uint8_t*)buffer;if(type==PET_VIEW){mainWidth=width;mainHeight=height;mainPixels.assign(bytes,bytes+size_t(width)*height*4);}else if(type==PET_POPUP&&width==popupRect.width&&height==popupRect.height)popupPixels.assign(bytes,bytes+size_t(width)*height*4);publish();};
 render.api.on_popup_show=[](cef_render_handler_t*,cef_browser_t*,int show){popupVisible=show;if(!show)popupPixels.clear();publish();};
 render.api.on_popup_size=[](cef_render_handler_t*,cef_browser_t*,const cef_rect_t* rect){popupRect=*rect;popupPixels.clear();};
 life.api.on_before_close=[](cef_life_span_handler_t*,cef_browser_t*){closed=true;};
 life.api.on_before_popup=[](cef_life_span_handler_t*,cef_browser_t*,cef_frame_t*,int,const cef_string_t*,const cef_string_t*,cef_window_open_disposition_t,int,const cef_popup_features_t*,cef_window_info_t*,cef_client_t**,cef_browser_settings_t*,cef_dictionary_value_t**,int*)->int{return 1;};
 load.api.on_load_end=[](cef_load_handler_t*,cef_browser_t*,cef_frame_t* frame,int http){if(frame->is_main(frame)){mapping.data->status.store(http==200?2:3);if(http==200&&target.find("#fx=")!=std::string::npos)script(fxClockScript);}};
 // Local network permission is required only by the existing authenticated loopback bridge.
 // Do not grant microphone/camera or unrelated origins permissions.
 permissions.api.on_show_permission_prompt=[](cef_permission_handler_t*,cef_browser_t*,uint64_t,const cef_string_t* origin,uint32_t requested,cef_permission_prompt_callback_t* callback)->int{
  const auto value=utf8(origin);if(value!="https://openclaw.blackcarburning.com"&&value!="https://openclaw.blackcarburning.com/")return 0;
  const uint32_t allowed=CEF_PERMISSION_TYPE_LOOPBACK_NETWORK;
  if((requested&~allowed)!=0)return 0;callback->cont(callback,CEF_PERMISSION_RESULT_ACCEPT);return 1;
 };
 downloads.api.on_before_download=[](cef_download_handler_t*,cef_browser_t*,cef_download_item_t*,const cef_string_t* name,cef_before_download_callback_t* callback)->int{callback->cont(callback,name,1);return 1;};
}
bool parentAlive(uint32_t pid){
#ifdef _WIN32
 auto p=OpenProcess(SYNCHRONIZE,FALSE,pid);if(!p)return false;bool alive=WaitForSingleObject(p,0)==WAIT_TIMEOUT;CloseHandle(p);return alive;
#else
 return kill(pid,0)==0;
#endif
}
void command(const Event& e,cef_browser_host_t* host){
 cef_mouse_event_t mouse{};mouse.x=e.x;mouse.y=e.y;mouse.modifiers=e.modifiers;
 switch(e.type){
 case Move:host->send_mouse_move_event(host,&mouse,e.a);break;
 case Down:case Up:host->send_mouse_click_event(host,&mouse,cef_mouse_button_type_t(e.a),e.type==Up,std::max(1,e.b));break;
 case Wheel:host->send_mouse_wheel_event(host,&mouse,e.a,e.b);break;
 case Focus:host->set_focus(host,e.a);break;
 case KeyDown:case KeyUp:case Char:{
#ifdef __APPLE__
  const bool shortcut=e.modifiers&128;
#else
  const bool shortcut=e.modifiers&4;
#endif
  // The windowless helper has no native Edit menu. Route explicit editing
  // shortcuts to Chromium's focused frame (including password-manager paste).
  if(shortcut&&!(e.modifiers&8)&&e.type==KeyDown){
   auto* frame=browser->get_focused_frame(browser);if(frame){bool handled=true;
    switch(e.a){case 'A':frame->select_all(frame);break;case 'C':frame->copy(frame);break;case 'X':frame->cut(frame);break;case 'V':frame->paste(frame);break;case 'Z':if(e.modifiers&2)frame->redo(frame);else frame->undo(frame);break;case 'Y':frame->redo(frame);break;default:handled=false;break;}
    frame->base.release(&frame->base);if(handled)break;
   }
  }
  cef_key_event_t key{};key.size=sizeof(key);key.type=e.type==Char?KEYEVENT_CHAR:e.type==KeyUp?KEYEVENT_KEYUP:KEYEVENT_RAWKEYDOWN;key.windows_key_code=e.a;key.native_key_code=e.b;key.character=key.unmodified_character=e.type==Char?char16_t(e.a):char16_t(e.x);key.modifiers=e.modifiers;host->send_key_event(host,&key);break;}
 case Store:script(target.find("#fx=")!=std::string::npos?"window.mygrainDawFx?.storeProject()":"window.mygrainDawBridge?.storeProject()");break;
 case TestDialog:if(diagnosticInput)testDialogReply(e.a!=0,mapping.data->dialogInput);break;
 case Reload:
  // Store first and wait for the acknowledged revision. Never reload after a failed/busy store.
  script("(async()=>{const refresh=()=>{const u=new URL("+quote(target)+");u.searchParams.set('cef_reload',String(Date.now()));location.replace(u.href);};const b=window["+quote(target.find("#fx=")!=std::string::npos?"mygrainDawFx":"mygrainDawBridge")+"];if(!b){refresh();return;}if(!b.connected){alert('Reconnect to the DAW before reloading so the current patch can be stored.');return;}const p=()=>b.diagnostics().project;const before=p();if(!before.ready||before.busy||before.storing){alert('Finish the current project operation before reloading.');return;}await b.storeProject();const until=Date.now()+125000;while(Date.now()<until){const d=p();if(!d.busy&&!d.storing){if(d.stats.count>before.stats.count){refresh();return;}break;}await new Promise(r=>setTimeout(r,100));}alert('Reload paused: the patch was not stored successfully. Your current app and previous snapshot are retained.');})()");break;
 }
}
int run(int argc,char** argv){
 if(!cef_api_hash(CEF_API_VERSION,0)||std::strcmp(cef_api_hash(CEF_API_VERSION,0),CEF_API_HASH_PLATFORM))return 70;
 setup();cef_main_args_t args{};
#ifdef _WIN32
 args.instance=GetModuleHandleW(nullptr);
#else
 args.argc=argc;args.argv=argv;
#endif
 const int child=cef_execute_process(&args,&app.api,nullptr);if(child>=0)return child;
 if(argc<4){std::cerr<<"MyGrain CEF is launched by the plugin.\n";return 64;}
 if(!mapping.open(argv[1],false))return 65;
 target=mapping.data->url;
 if(target.rfind("https://openclaw.blackcarburning.com/mygrain/",0)!=0)return 66;
 const uint32_t pid=uint32_t(std::stoul(argv[2]));
 auto profile=std::filesystem::absolute(std::filesystem::u8path(argv[3]));std::filesystem::create_directories(profile);
#ifdef __APPLE__
 [MyGrainCEFApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
#endif
 cef_settings_t settings{};settings.size=sizeof(settings);settings.no_sandbox=1;settings.windowless_rendering_enabled=1;settings.persist_session_cookies=1;
 String cache(pathString(profile));cef_string_utf16_set(cache.value.str,cache.value.length,&settings.root_cache_path,1);cef_string_utf16_set(cache.value.str,cache.value.length,&settings.cache_path,1);
 settings.log_severity=LOGSEVERITY_ERROR;
 String log(pathString(profile/"cef.log"));cef_string_utf16_set(log.value.str,log.value.length,&settings.log_file,1);
 if(argc>4){settings.remote_debugging_port=std::stoi(argv[4]);diagnosticInput=settings.remote_debugging_port!=0;} // Test harness only.
#ifdef __APPLE__
 NSString* subprocess=[NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/Frameworks/MyGrainCEF Helper.app/Contents/MacOS/MyGrainCEF Helper"];
 String childPath(subprocess.fileSystemRepresentation);cef_string_utf16_set(childPath.value.str,childPath.value.length,&settings.browser_subprocess_path,1);
#endif
 if(!cef_initialize(&args,&settings,&app.api,nullptr)){mapping.data->status.store(4);return 67;}
 cef_window_info_t window{};window.size=sizeof(window);window.windowless_rendering_enabled=1;window.runtime_style=CEF_RUNTIME_STYLE_ALLOY;
 cef_browser_settings_t options{};options.size=sizeof(options);options.windowless_frame_rate=30;options.background_color=0xff131825;
 String url("about:blank");browser=cef_browser_host_create_browser_sync(&window,&client.api,url,&options,nullptr,nullptr);
 if(!browser){mapping.data->status.store(5);cef_shutdown();return 68;}
 // CefAudioHandler captures/suppresses the speaker path. Do not explicitly mute
 // the browser: that also silences the PCM needed by widget/media previews.
 auto* host=browser->get_host(browser);mapping.data->status.store(1);
 bool managerReady=false;
 // Callback objects outlive initialization; no captured stack references.
 cookieReady.api.on_complete=[](cef_completion_callback_t*){loginImported=true;};
 auto* cookies=cef_cookie_manager_get_global_manager(cookieReady.get());
 auto waitCookie=[&](){const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(3);while(!loginImported&&std::chrono::steady_clock::now()<end){cef_do_message_loop_work();std::this_thread::sleep_for(std::chrono::milliseconds(5));}};
 waitCookie();managerReady=loginImported;
 lastLogin=RememberedLogin::read();
 if(cookies&&managerReady&&lastLogin.valid()){
  cef_cookie_t value{};value.size=sizeof(value);value.same_site=CEF_COOKIE_SAME_SITE_LAX_MODE;String name("mygrain_session"),token(lastLogin.token),cookiePath("/"),cookieUrl("https://openclaw.blackcarburning.com/");value.name=name.value;value.value=token.value;value.path=cookiePath.value;value.secure=value.httponly=value.has_expires=1;value.expires.val=int64_t((lastLogin.expires+11644473600.0)*1000000.0);
  loginImported=false;cookieSet.api.on_complete=[](cef_set_cookie_callback_t*,int){loginImported=true;};if(!cookies->set_cookie(cookies,cookieUrl,&value,cookieSet.get()))loginImported=true;waitCookie();
 }
 auto* initialFrame=browser->get_main_frame(browser);if(initialFrame){String initial(target);initialFrame->load_url(initialFrame,initial);initialFrame->base.release(&initialFrame->base);}
 auto nextLoginCheck=std::chrono::steady_clock::now();
 uint32_t width=mapping.data->width.load(),height=mapping.data->height.load();bool quitting=false;
 while(!closed){
  cef_do_message_loop_work();
#ifdef _WIN32
  MSG message;while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){if(!dialogWindow||!IsDialogMessageW(dialogWindow,&message)){TranslateMessage(&message);DispatchMessageW(&message);}}
#endif
  if(!quitting&&std::chrono::steady_clock::now()>=nextLoginCheck){rememberLogin(cookies);nextLoginCheck=std::chrono::steady_clock::now()+std::chrono::milliseconds(250);}
  if(!quitting&&(mapping.data->quit.load()||!parentAlive(pid))){quitting=true;host->close_browser(host,1);}
  if(!quitting){
   auto w=mapping.data->width.load(),h=mapping.data->height.load();if(w!=width||h!=height){width=w;height=h;host->was_resized(host);}
   // An editor is only an OSR display surface, not browser visibility. CEF's
   // was_hidden() suspends Web Audio on macOS despite background-timer switches.
   // Keep this headless renderer active until the owning component unloads.
   Event e;while(mapping.pop(e))command(e,host);
  }
  std::this_thread::sleep_for(std::chrono::milliseconds(5));
 }
 if(dialogCallback)dismissDialog(false,false);
 rememberLogin(cookies);const auto cookieEnd=std::chrono::steady_clock::now()+std::chrono::milliseconds(500);while(loginVisitPending&&std::chrono::steady_clock::now()<cookieEnd)cef_do_message_loop_work();
 if(cookies)cookies->base.release(&cookies->base);
 host->base.release(&host->base);browser->base.release(&browser->base);browser=nullptr;
 cef_shutdown();cef_string_utf16_clear(&settings.cache_path);cef_string_utf16_clear(&settings.root_cache_path);cef_string_utf16_clear(&settings.log_file);cef_string_utf16_clear(&settings.browser_subprocess_path);return 0;
}
}
#ifdef __APPLE__
@implementation MyGrainDialogAction
- (void)accept:(id)sender{dismissDialog(true);}
- (void)cancel:(id)sender{dismissDialog(false);}
@end
#endif
int main(int argc,char**argv){
#ifdef _WIN32
 // CEF and filesystem paths use UTF-8, including non-ASCII Windows user folders.
 int count=0;auto** wide=CommandLineToArgvW(GetCommandLineW(),&count);std::vector<std::string> strings;std::vector<char*> pointers;
 if(!wide)return 64;for(int i=0;i<count;i++){int n=WideCharToMultiByte(CP_UTF8,0,wide[i],-1,nullptr,0,nullptr,nullptr);std::string s(n,'\0');WideCharToMultiByte(CP_UTF8,0,wide[i],-1,s.data(),n,nullptr,nullptr);s.pop_back();strings.push_back(std::move(s));}LocalFree(wide);for(auto& s:strings)pointers.push_back(s.data());pointers.push_back(nullptr);argc=count;argv=pointers.data();
#endif
#ifdef __APPLE__
 @autoreleasepool{
  // Browser output is intentionally muted: declare user-requested real-time work
  // explicitly, rather than relying on audible speakers to prevent App Nap.
  id activity=[[[NSProcessInfo processInfo] beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep|NSActivityLatencyCritical reason:@"MyGrain CEF real-time DAW audio and project storage"] retain];
  int result=run(argc,argv);[[NSProcessInfo processInfo] endActivity:activity];[activity release];return result;
 }
#else
 try{return run(argc,argv);}catch(...){if(mapping.data)mapping.data->status.store(6);return 69;}
#endif
}
