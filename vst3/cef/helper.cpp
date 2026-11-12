// The ONLY executable that initializes CEF. The DAW plugin never loads libcef.
#include "ipc.h"
#include "include/capi/cef_app_capi.h"
#include "include/capi/cef_client_capi.h"
#include "include/capi/cef_render_handler_capi.h"
#include "include/capi/cef_life_span_handler_capi.h"
#include "include/capi/cef_load_handler_capi.h"
#include "include/capi/cef_permission_handler_capi.h"
#include "include/capi/cef_download_handler_capi.h"
#include "include/capi/cef_frame_capi.h"
#include "include/cef_api_hash.h"
#include <filesystem>
#include <chrono>
#include <thread>
#include <iostream>
#ifdef _WIN32
#include <shellapi.h>
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
#endif
namespace {
using namespace mygrain::cef;
Mapping mapping;
cef_browser_t* browser=nullptr;bool closed=false;
std::string target;
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
Object<cef_life_span_handler_t> life;
Object<cef_load_handler_t> load;
Object<cef_permission_handler_t> permissions;
Object<cef_download_handler_t> downloads;
void setup(){
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
 render.api.get_view_rect=[](cef_render_handler_t*,cef_browser_t*,cef_rect_t* rect){rect->x=rect->y=0;rect->width=mapping.data->width.load();rect->height=mapping.data->height.load();};
 render.api.on_paint=[](cef_render_handler_t*,cef_browser_t*,cef_paint_element_type_t type,size_t,const cef_rect_t*,const void* buffer,int width,int height){
  if(width<1||height<1||width>int(maxWidth)||height>int(maxHeight))return;
  const auto* bytes=(const uint8_t*)buffer;if(type==PET_VIEW){mainWidth=width;mainHeight=height;mainPixels.assign(bytes,bytes+size_t(width)*height*4);}else if(type==PET_POPUP&&width==popupRect.width&&height==popupRect.height)popupPixels.assign(bytes,bytes+size_t(width)*height*4);publish();};
 render.api.on_popup_show=[](cef_render_handler_t*,cef_browser_t*,int show){popupVisible=show;if(!show)popupPixels.clear();publish();};
 render.api.on_popup_size=[](cef_render_handler_t*,cef_browser_t*,const cef_rect_t* rect){popupRect=*rect;popupPixels.clear();};
 life.api.on_before_close=[](cef_life_span_handler_t*,cef_browser_t*){closed=true;};
 life.api.on_before_popup=[](cef_life_span_handler_t*,cef_browser_t*,cef_frame_t*,int,const cef_string_t*,const cef_string_t*,cef_window_open_disposition_t,int,const cef_popup_features_t*,cef_window_info_t*,cef_client_t**,cef_browser_settings_t*,cef_dictionary_value_t**,int*)->int{return 1;};
 load.api.on_load_end=[](cef_load_handler_t*,cef_browser_t*,cef_frame_t* frame,int http){if(frame->is_main(frame)){mapping.data->status.store(http==200?2:3);}};
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
 case KeyDown:case KeyUp:case Char:{cef_key_event_t key{};key.size=sizeof(key);key.type=e.type==Char?KEYEVENT_CHAR:e.type==KeyUp?KEYEVENT_KEYUP:KEYEVENT_RAWKEYDOWN;key.windows_key_code=e.a;key.native_key_code=e.b;key.character=key.unmodified_character=e.type==Char?char16_t(e.a):0;key.modifiers=e.modifiers;host->send_key_event(host,&key);break;}
 case Store:script("window.mygrainDawBridge?.storeProject()");break;
 case Reload:
  // Store first and wait for the acknowledged revision. Never reload after a failed/busy store.
  script("(async()=>{const b=window.mygrainDawBridge;if(!b?.connected){location.replace("+quote(target)+");return;}const p=()=>b.diagnostics().project;const before=p();if(!before.ready||before.busy||before.storing){alert('Finish the current project operation before reloading.');return;}await b.storeProject();const until=Date.now()+125000;while(Date.now()<until){const d=p();if(!d.busy&&!d.storing){if(d.stats.count>before.stats.count){location.replace("+quote(target)+");return;}break;}await new Promise(r=>setTimeout(r,100));}alert('Reload paused: the patch was not stored successfully. Your current app and previous snapshot are retained.');})()");break;
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
 if(argc>4)settings.remote_debugging_port=std::stoi(argv[4]); // Test harness only; no debug listener in released plugin launches.
#ifdef __APPLE__
 NSString* subprocess=[NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/Frameworks/MyGrainCEF Helper.app/Contents/MacOS/MyGrainCEF Helper"];
 String childPath(subprocess.fileSystemRepresentation);cef_string_utf16_set(childPath.value.str,childPath.value.length,&settings.browser_subprocess_path,1);
#endif
 if(!cef_initialize(&args,&settings,&app.api,nullptr)){mapping.data->status.store(4);return 67;}
 cef_window_info_t window{};window.size=sizeof(window);window.windowless_rendering_enabled=1;window.runtime_style=CEF_RUNTIME_STYLE_ALLOY;
 cef_browser_settings_t options{};options.size=sizeof(options);options.windowless_frame_rate=30;options.background_color=0xff131825;
 String url(target);browser=cef_browser_host_create_browser_sync(&window,&client.api,url,&options,nullptr,nullptr);
 if(!browser){mapping.data->status.store(5);cef_shutdown();return 68;}
 auto* host=browser->get_host(browser);host->set_audio_muted(host,1);mapping.data->status.store(1);
 uint32_t width=mapping.data->width.load(),height=mapping.data->height.load();bool quitting=false;
 while(!closed){
  cef_do_message_loop_work();
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
 host->base.release(&host->base);browser->base.release(&browser->base);browser=nullptr;
 cef_shutdown();cef_string_utf16_clear(&settings.cache_path);cef_string_utf16_clear(&settings.root_cache_path);cef_string_utf16_clear(&settings.log_file);cef_string_utf16_clear(&settings.browser_subprocess_path);return 0;
}
}
int main(int argc,char**argv){
#ifdef _WIN32
 // CEF and filesystem paths use UTF-8, including non-ASCII Windows user folders.
 int count=0;auto** wide=CommandLineToArgvW(GetCommandLineW(),&count);std::vector<std::string> strings;std::vector<char*> pointers;
 if(!wide)return 64;for(int i=0;i<count;i++){int n=WideCharToMultiByte(CP_UTF8,0,wide[i],-1,nullptr,0,nullptr,nullptr);std::string s(n,'\0');WideCharToMultiByte(CP_UTF8,0,wide[i],-1,s.data(),n,nullptr,nullptr);s.pop_back();strings.push_back(std::move(s));}LocalFree(wide);for(auto& s:strings)pointers.push_back(s.data());pointers.push_back(nullptr);argc=count;argv=pointers.data();
#endif
#ifdef __APPLE__
 @autoreleasepool{return run(argc,argv);}
#else
 try{return run(argc,argv);}catch(...){if(mapping.data)mapping.data->status.store(6);return 69;}
#endif
}
