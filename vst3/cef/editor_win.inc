// Editor is only a remote CEF surface. Closing it never closes the browser.
namespace {
struct CefSurface {
 Bridge& owner;bool hostKeyboard=false,focused=false;HWND window=nullptr;uint32_t frame=0,w=0,h=0;std::vector<uint8_t> pixels;std::string status;
 explicit CefSurface(Bridge& b):owner(b){}
 static uint32_t modifiers(){uint32_t m=0;if(GetKeyState(VK_SHIFT)<0)m|=2;if(GetKeyState(VK_CONTROL)<0)m|=4;if(GetKeyState(VK_MENU)<0)m|=8;if(GetKeyState(VK_LBUTTON)<0)m|=16;if(GetKeyState(VK_MBUTTON)<0)m|=32;if(GetKeyState(VK_RBUTTON)<0)m|=64;return m;}
 void event(cef::EventType type,int x=0,int y=0,int a=0,int b=0){owner.embedded.ipc.push({type,x,y-68,a,b,modifiers()});}
 void tick(){
  auto& session=owner.embedded;
  if(!session.attempted&&owner.server&&owner.server->port()){
   wchar_t path[32768]{};GetModuleFileNameW(ghInst,path,32768);const auto helper=(std::filesystem::path(path).parent_path()/L"cef"/L"MyGrainCEF.exe").u8string();
   session.start(helper,owner.server->url());RECT r{};GetClientRect(window,&r);session.resize(r.right,r.bottom-68);session.visible(true);
  }
  auto* shared=session.ipc.data;
  if(shared&&shared->frame.load()!=frame){uint32_t width=0,height=0;if(session.ipc.copy(pixels,width,height)){w=width;h=height;frame=shared->frame.load();RECT dirty{0,68,LONG(w),LONG(h+68)};InvalidateRect(window,&dirty,FALSE);}}
  auto remote=owner.engine.remote.get();
  std::string next=!session.error.empty()?session.error:session.attempted&&!session.running()?"CEF stopped. Close and reload this plugin instance; the last completed DAW snapshot is retained.":!owner.engine.connected.load()?"Loading MyGrain CEF. Sign in, then Start MYGRAIN if requested.":remote.companion.supported?remote.companion.text:remote.text;
  if(remote.companion.supported)next+=" | Auto-save "+std::string(remote.companion.autoStore?"On":"Off")+" / "+std::to_string(remote.companion.interval)+"s | "+std::to_string(remote.companion.count)+" stores";
  if(next!=status){status=next;SetWindowTextW(GetDlgItem(window,230),cef::wide(status).c_str());}
  const bool ready=remote.supported&&remote.ready&&!remote.busy;
  for(int id:{101,102,220}){const bool enabled=id==101?session.running():ready;if(bool(IsWindowEnabled(GetDlgItem(window,id)))!=enabled)EnableWindow(GetDlgItem(window,id),enabled);}
  const auto armed=owner.engine.armed.load();const wchar_t* label=armed?L"Armed - follow DAW":L"Arm - follow DAW";wchar_t previous[64]{};GetWindowTextW(GetDlgItem(window,106),previous,64);if(std::wcscmp(previous,label))SetWindowTextW(GetDlgItem(window,106),label);
 }
 static LRESULT CALLBACK proc(HWND window,UINT message,WPARAM wp,LPARAM lp){
  auto* s=(CefSurface*)GetWindowLongPtrW(window,GWLP_USERDATA);
  if(message==WM_NCCREATE){s=(CefSurface*)((CREATESTRUCTW*)lp)->lpCreateParams;s->window=window;SetWindowLongPtrW(window,GWLP_USERDATA,(LONG_PTR)s);}
  if(!s)return DefWindowProcW(window,message,wp,lp);
  const int x=short(LOWORD(lp)),y=short(HIWORD(lp));
  switch(message){
  case WM_CREATE:{int left=8;for(const auto& b:std::initializer_list<std::pair<int,const wchar_t*>>{{106,L"Arm - follow DAW"},{104,L"Stop"},{102,L"Store now"},{220,L"Auto-save On/Off"},{101,L"Store + reload app"}}){const int width=b.first==104?65:b.first==102?95:170;CreateWindowExW(0,L"BUTTON",b.second,WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_PUSHBUTTON,left,5,width,28,window,(HMENU)(INT_PTR)b.first,ghInst,nullptr);left+=width+6;}
   CreateWindowExW(0,L"STATIC",L"Loading MyGrain CEF...",WS_CHILD|WS_VISIBLE|SS_LEFT,8,39,1210,25,window,(HMENU)230,ghInst,nullptr);SetTimer(window,1,33,nullptr);return 0;}
  case WM_TIMER:s->tick();return 0;
  case WM_SIZE:s->owner.embedded.resize(LOWORD(lp),std::max(200,int(HIWORD(lp))-68));MoveWindow(GetDlgItem(window,230),8,39,std::max(100,int(LOWORD(lp))-16),25,TRUE);return 0;
  case WM_COMMAND:switch(LOWORD(wp)){case 101:s->event(cef::Reload);break;case 102:s->owner.engine.remote.request(5);break;case 220:s->owner.engine.remote.request(11,0,!s->owner.engine.remote.get().companion.autoStore);break;case 106:s->owner.engine.requestArm();break;case 104:s->owner.engine.requestStop();break;}return 0;
  case WM_SETFOCUS:s->focused=true;s->event(cef::Focus,0,68,1);return 0;
  case WM_KILLFOCUS:s->focused=false;s->hostKeyboard=false;s->event(cef::Focus);return 0;
  case WM_MOUSEMOVE:if(y>=68)s->event(cef::Move,x,y);return 0;
  case WM_LBUTTONDOWN:case WM_RBUTTONDOWN:case WM_MBUTTONDOWN:case WM_LBUTTONDBLCLK:if(y>=68){SetFocus(window);s->event(cef::Focus,0,68,1);SetCapture(window);s->event(cef::Down,x,y,message==WM_RBUTTONDOWN?2:message==WM_MBUTTONDOWN?1:0,message==WM_LBUTTONDBLCLK?2:1);}return 0;
  case WM_LBUTTONUP:case WM_RBUTTONUP:case WM_MBUTTONUP:ReleaseCapture();s->event(cef::Up,x,y,message==WM_RBUTTONUP?2:message==WM_MBUTTONUP?1:0,1);return 0;
  case WM_MOUSEWHEEL:case WM_MOUSEHWHEEL:{POINT p{x,y};ScreenToClient(window,&p);s->event(cef::Wheel,p.x,p.y,message==WM_MOUSEHWHEEL?short(HIWORD(wp)):0,message==WM_MOUSEWHEEL?short(HIWORD(wp)):0);return 0;}
  case WM_KEYDOWN:case WM_SYSKEYDOWN:if(!s->hostKeyboard)s->event(cef::KeyDown,0,68,int(wp),int(lp));return 0;
  case WM_KEYUP:case WM_SYSKEYUP:if(!s->hostKeyboard)s->event(cef::KeyUp,0,68,int(wp),int(lp));return 0;
  case WM_CHAR:if(!s->hostKeyboard)s->event(cef::Char,0,68,int(wp),int(lp));return 0;
  case WM_GETDLGCODE:return DLGC_WANTALLKEYS|DLGC_WANTARROWS|DLGC_WANTCHARS;
  case WM_ERASEBKGND:return 1;
  case WM_PAINT:{PAINTSTRUCT ps;HDC dc=BeginPaint(window,&ps);RECT r{};GetClientRect(window,&r);RECT toolbar{0,0,r.right,68};FillRect(dc,&toolbar,(HBRUSH)GetStockObject(DKGRAY_BRUSH));if(s->w&&s->h){BITMAPINFO info{};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);info.bmiHeader.biWidth=s->w;info.bmiHeader.biHeight=-LONG(s->h);info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;StretchDIBits(dc,0,68,r.right,r.bottom-68,0,0,s->w,s->h,s->pixels.data(),&info,DIB_RGB_COLORS,SRCCOPY);}else{RECT browser{0,68,r.right,r.bottom};FillRect(dc,&browser,(HBRUSH)GetStockObject(DKGRAY_BRUSH));}EndPaint(window,&ps);return 0;}
  case WM_DESTROY:KillTimer(window,1);return 0;
  }return DefWindowProcW(window,message,wp,lp);
 }
};
}
BridgeView::BridgeView(Bridge& b):owner(b){owner.addRef();rect=ViewRect(0,0,1240,824);}
BridgeView::~BridgeView(){removed();owner.release();}
tresult PLUGIN_API BridgeView::attached(void* parent,FIDString type){
 if(isPlatformTypeSupported(type)!=kResultTrue||!parent||native)return kResultFalse;owner.enable();
 WNDCLASSW wc{};wc.style=CS_DBLCLKS;wc.lpfnWndProc=CefSurface::proc;wc.hInstance=ghInst;wc.lpszClassName=L"MyGrainCEFView010";wc.hCursor=LoadCursor(nullptr,IDC_ARROW);RegisterClassW(&wc);
 auto* surface=new CefSurface(owner);native=surface;auto hwnd=CreateWindowExW(0,wc.lpszClassName,L"MyGrain CEF",WS_CHILD|WS_VISIBLE|WS_CLIPCHILDREN|WS_TABSTOP,0,0,rect.getWidth(),rect.getHeight(),(HWND)parent,nullptr,ghInst,surface);
 if(!hwnd){delete surface;native=nullptr;return kResultFalse;}owner.embedded.visible(true);return CPluginView::attached(parent,type);
}
tresult PLUGIN_API BridgeView::removed(){if(native){auto* surface=(CefSurface*)native;native=nullptr;owner.embedded.visible(false);DestroyWindow(surface->window);delete surface;}return CPluginView::removed();}
tresult PLUGIN_API BridgeView::onSize(ViewRect* size){if(!size)return kInvalidArgument;rect=*size;if(native)MoveWindow(((CefSurface*)native)->window,0,0,rect.getWidth(),rect.getHeight(),TRUE);return kResultOk;}

tresult PLUGIN_API BridgeView::onFocus(TBool focused){
 if(!native)return kResultFalse;auto* s=(CefSurface*)native;
 s->focused=focused;if(focused){auto current=GetFocus();if(current!=s->window&&!IsChild(s->window,current))SetFocus(s->window);}
 else s->hostKeyboard=false;
 return owner.embedded.ipc.push({cef::Focus,0,0,focused?1:0})?kResultTrue:kResultFalse;
}
tresult PLUGIN_API BridgeView::onKeyDown(char16 key,int16 code,int16 modifiers){
 if(!native||!((CefSurface*)native)->focused||GetFocus()!=((CefSurface*)native)->window)return kResultFalse;
 auto* s=(CefSurface*)native;s->hostKeyboard=true;return cef::hostKey(owner.embedded.ipc,false,key,code,modifiers)?kResultTrue:kResultFalse;
}
tresult PLUGIN_API BridgeView::onKeyUp(char16 key,int16 code,int16 modifiers){
 if(!native||!((CefSurface*)native)->focused||GetFocus()!=((CefSurface*)native)->window)return kResultFalse;
 return cef::hostKey(owner.embedded.ipc,true,key,code,modifiers)?kResultTrue:kResultFalse;
}
