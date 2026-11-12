// Editor is only a remote CEF surface. Closing it never closes the browser.
namespace {
struct CefSurface {
 Bridge& owner;bool hostKeyboard=false,focused=false;HWND window=nullptr;uint32_t frame=0,w=0,h=0;std::vector<uint8_t> pixels;std::string status,details;ULONG_PTR graphicsToken=0;HFONT font=nullptr,smallFont=nullptr;uint32_t displayedInterval=0;HBRUSH background=CreateSolidBrush(RGB(16,22,33)),inputBackground=CreateSolidBrush(RGB(18,36,52));
 explicit CefSurface(Bridge& b):owner(b){Gdiplus::GdiplusStartupInput input;Gdiplus::GdiplusStartup(&graphicsToken,&input,nullptr);font=CreateFontW(-13,0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");smallFont=CreateFontW(-12,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");}
 ~CefSurface(){DeleteObject(font);DeleteObject(smallFont);DeleteObject(background);DeleteObject(inputBackground);if(graphicsToken)Gdiplus::GdiplusShutdown(graphicsToken);}
 void layout(int width){const double scale=cef::toolbarScale(width);double left=12;for(auto item:cef::toolbarItems){MoveWindow(GetDlgItem(window,item.id),int(left),8,int(item.width*scale),36,TRUE);left+=(item.width+8)*scale;}for(int id:{230,231})MoveWindow(GetDlgItem(window,id),12,id==230?51:74,std::max(100,width-24),21,TRUE);}
 void interval(){wchar_t value[32]{};GetWindowTextW(GetDlgItem(window,221),value,32);wchar_t* end=nullptr;auto seconds=std::wcstoul(value,&end,10);if(end!=value&&!*end&&seconds>=15&&seconds<=3600){owner.engine.remote.request(12,0,uint32_t(seconds));}else{SetWindowTextW(GetDlgItem(window,230),L"Choose an automatic-save interval from 15 to 3600 seconds.");status.clear();}}
 void drawButton(DRAWITEMSTRUCT* item){
  using namespace Gdiplus;const int width=item->rcItem.right,height=item->rcItem.bottom;Bitmap buffer(width,height,PixelFormat32bppPARGB);Graphics g(&buffer);g.SetSmoothingMode(SmoothingModeAntiAlias);SolidBrush bg(Color(255,16,22,33));g.FillRectangle(&bg,0,0,width,height);
  const bool enabled=!(item->itemState&ODS_DISABLED),active=(item->CtlID==106&&owner.engine.armed.load())||(item->CtlID==220&&owner.engine.remote.get().companion.autoStore);
  Color top(255,32,82,115),bottom(255,18,51,79),edge(255,103,151,184),ink(255,240,248,255);
  if(active){top=Color(255,29,100,89);bottom=Color(255,18,67,56);edge=Color(255,133,227,198);}
  if(item->CtlID==104){top=Color(255,125,23,49);bottom=Color(255,80,22,40);edge=Color(255,224,122,147);}
  if(!enabled){top=bottom=Color(255,24,43,62);edge=Color(255,79,99,121);ink=Color(255,151,171,192);}
  if(item->itemState&ODS_SELECTED)top=bottom;
  GraphicsPath path;const float w=float(width-2),h=float(height-2),r=18;path.AddArc(1.f,1.f,r,r,180.f,90.f);path.AddArc(w-r,1.f,r,r,270.f,90.f);path.AddArc(w-r,h-r,r,r,0.f,90.f);path.AddArc(1.f,h-r,r,r,90.f,90.f);path.CloseFigure();LinearGradientBrush fill(PointF(0,0),PointF(float(width),float(height)),top,bottom);Pen border(edge,item->itemState&ODS_FOCUS?2.4f:1.2f);g.FillPath(&fill,&path);g.DrawPath(&border,&path);
  wchar_t title[128]{};GetWindowTextW(item->hwndItem,title,128);FontFamily family(L"Segoe UI");Font type(&family,width<100?11.f:12.f,FontStyleBold,UnitPixel);SolidBrush text(ink);StringFormat format;format.SetAlignment(StringAlignmentCenter);format.SetLineAlignment(StringAlignmentCenter);g.DrawString(title,-1,&type,RectF(5,2,float(width-10),float(height-4)),&format,&text);Graphics target(item->hDC);target.DrawImage(&buffer,0,0);
 }
 static uint32_t modifiers(){uint32_t m=0;if(GetKeyState(VK_SHIFT)<0)m|=2;if(GetKeyState(VK_CONTROL)<0)m|=4;if(GetKeyState(VK_MENU)<0)m|=8;if(GetKeyState(VK_LBUTTON)<0)m|=16;if(GetKeyState(VK_MBUTTON)<0)m|=32;if(GetKeyState(VK_RBUTTON)<0)m|=64;return m;}
 void event(cef::EventType type,int x=0,int y=0,int a=0,int b=0){owner.embedded.ipc.push({type,x,y-cef::toolbarHeight,a,b,modifiers()});}
 void tick(){
  auto& session=owner.embedded;
  if(!session.attempted&&owner.server&&owner.server->port()){
   wchar_t path[32768]{};GetModuleFileNameW(ghInst,path,32768);const auto helper=(std::filesystem::path(path).parent_path()/L"cef"/L"MyGrainCEF.exe").u8string();
   session.start(helper,owner.server->url());RECT r{};GetClientRect(window,&r);session.resize(r.right,r.bottom-cef::toolbarHeight);session.visible(true);
  }
  auto* shared=session.ipc.data;
  if(shared&&shared->frame.load()!=frame){uint32_t width=0,height=0;if(session.ipc.copy(pixels,width,height)){w=width;h=height;frame=shared->frame.load();RECT dirty{0,cef::toolbarHeight,LONG(w),LONG(h+cef::toolbarHeight)};InvalidateRect(window,&dirty,FALSE);}}
  auto remote=owner.engine.remote.get();
  std::string next=!session.error.empty()?session.error:session.attempted&&!session.running()?"CEF stopped. Close and reload this plugin instance; the last completed DAW snapshot is retained.":!owner.engine.connected.load()?"Loading MyGrain CEF. Sign in, then Start MYGRAIN if requested.":cef::toolbarActivity(remote,owner.engine.armed.load(),owner.engine.playing.load());
  if(next!=status){status=next;SetWindowTextW(GetDlgItem(window,230),cef::wide(status).c_str());}
  auto stats=cef::toolbarStats(remote.companion);if(stats!=details){details=stats;SetWindowTextW(GetDlgItem(window,231),cef::wide(details).c_str());}
  const bool ready=remote.supported&&remote.ready&&!remote.busy;
  for(int id:{101,102,220,221,222}){const bool enabled=id==101?session.running():ready;if(bool(IsWindowEnabled(GetDlgItem(window,id)))!=enabled)EnableWindow(GetDlgItem(window,id),enabled);}
  for(int id:{106,220}){const wchar_t* label=id==106?(owner.engine.armed.load()?L"Armed - follow DAW":L"Arm - follow DAW"):(remote.companion.autoStore?L"Auto-save: On":L"Auto-save: Off");wchar_t previous[64]{};GetWindowTextW(GetDlgItem(window,id),previous,64);if(std::wcscmp(previous,label)){SetWindowTextW(GetDlgItem(window,id),label);InvalidateRect(GetDlgItem(window,id),nullptr,FALSE);}}
  if(GetFocus()!=GetDlgItem(window,221)&&displayedInterval!=remote.companion.interval){displayedInterval=remote.companion.interval;const auto label=std::to_wstring(remote.companion.interval);wchar_t previous[32]{};GetWindowTextW(GetDlgItem(window,221),previous,32);if(label!=previous)SetWindowTextW(GetDlgItem(window,221),label.c_str());}
 }
 static LRESULT CALLBACK proc(HWND window,UINT message,WPARAM wp,LPARAM lp){
  auto* s=(CefSurface*)GetWindowLongPtrW(window,GWLP_USERDATA);
  if(message==WM_NCCREATE){s=(CefSurface*)((CREATESTRUCTW*)lp)->lpCreateParams;s->window=window;SetWindowLongPtrW(window,GWLP_USERDATA,(LONG_PTR)s);}
  if(!s)return DefWindowProcW(window,message,wp,lp);
  const int x=short(LOWORD(lp)),y=short(HIWORD(lp));
  switch(message){
  case WM_CREATE:{for(auto item:cef::toolbarItems){const bool edit=item.id==221,label=item.id==223;auto title=cef::wide(std::string(item.title));auto control=CreateWindowExW(edit?WS_EX_CLIENTEDGE:0,edit?L"EDIT":label?L"STATIC":L"BUTTON",title.c_str(),WS_CHILD|WS_VISIBLE|(label?SS_CENTER|SS_CENTERIMAGE:WS_TABSTOP|(edit?ES_NUMBER|ES_CENTER|ES_AUTOHSCROLL:BS_OWNERDRAW)),0,0,1,1,window,(HMENU)(INT_PTR)item.id,ghInst,nullptr);SendMessageW(control,WM_SETFONT,(WPARAM)s->font,TRUE);if(edit)SendMessageW(control,EM_SETLIMITTEXT,4,0);}
   for(int id:{230,231}){auto control=CreateWindowExW(0,L"STATIC",id==230?L"Loading MyGrain CEF...":L"Automatic patch storage runs with the editor closed. Save the DAW project normally.",WS_CHILD|WS_VISIBLE|SS_LEFT|SS_ENDELLIPSIS,0,0,1,1,window,(HMENU)(INT_PTR)id,ghInst,nullptr);SendMessageW(control,WM_SETFONT,(WPARAM)s->smallFont,TRUE);}RECT r{};GetClientRect(window,&r);s->layout(r.right);SetTimer(window,1,33,nullptr);return 0;}
  case WM_TIMER:s->tick();return 0;
  case WM_SIZE:s->owner.embedded.resize(LOWORD(lp),std::max(200,int(HIWORD(lp))-cef::toolbarHeight));s->layout(LOWORD(lp));return 0;
  case WM_DRAWITEM:s->drawButton((DRAWITEMSTRUCT*)lp);return TRUE;
  case WM_CTLCOLORSTATIC:SetBkMode((HDC)wp,TRANSPARENT);SetTextColor((HDC)wp,GetDlgCtrlID((HWND)lp)==230?RGB(225,239,250):RGB(166,189,210));return (LRESULT)s->background;
  case WM_CTLCOLOREDIT:SetTextColor((HDC)wp,RGB(240,248,255));SetBkColor((HDC)wp,RGB(18,36,52));return (LRESULT)s->inputBackground;
  case WM_COMMAND:switch(LOWORD(wp)){case 101:s->event(cef::Reload);break;case 102:s->owner.engine.remote.request(5);break;case 220:s->owner.engine.remote.request(11,0,!s->owner.engine.remote.get().companion.autoStore);break;case 222:s->interval();break;case 106:s->owner.engine.requestArm();break;case 104:s->owner.engine.requestStop();break;}return 0;
  case WM_SETFOCUS:s->focused=true;s->event(cef::Focus,0,cef::toolbarHeight,1);return 0;
  case WM_KILLFOCUS:s->focused=false;s->hostKeyboard=false;s->event(cef::Focus);return 0;
  case WM_MOUSEMOVE:if(y>=cef::toolbarHeight)s->event(cef::Move,x,y);return 0;
  case WM_LBUTTONDOWN:case WM_RBUTTONDOWN:case WM_MBUTTONDOWN:case WM_LBUTTONDBLCLK:if(y>=cef::toolbarHeight){SetFocus(window);s->event(cef::Focus,0,cef::toolbarHeight,1);SetCapture(window);s->event(cef::Down,x,y,message==WM_RBUTTONDOWN?2:message==WM_MBUTTONDOWN?1:0,message==WM_LBUTTONDBLCLK?2:1);}return 0;
  case WM_LBUTTONUP:case WM_RBUTTONUP:case WM_MBUTTONUP:ReleaseCapture();s->event(cef::Up,x,y,message==WM_RBUTTONUP?2:message==WM_MBUTTONUP?1:0,1);return 0;
  case WM_MOUSEWHEEL:case WM_MOUSEHWHEEL:{POINT p{x,y};ScreenToClient(window,&p);s->event(cef::Wheel,p.x,p.y,message==WM_MOUSEHWHEEL?short(HIWORD(wp)):0,message==WM_MOUSEWHEEL?short(HIWORD(wp)):0);return 0;}
  case WM_KEYDOWN:case WM_SYSKEYDOWN:if(!s->hostKeyboard)s->event(cef::KeyDown,0,cef::toolbarHeight,int(wp),int(lp));return 0;
  case WM_KEYUP:case WM_SYSKEYUP:if(!s->hostKeyboard)s->event(cef::KeyUp,0,cef::toolbarHeight,int(wp),int(lp));return 0;
  case WM_CHAR:if(!s->hostKeyboard)s->event(cef::Char,0,cef::toolbarHeight,int(wp),int(lp));return 0;
  case WM_GETDLGCODE:return DLGC_WANTALLKEYS|DLGC_WANTARROWS|DLGC_WANTCHARS;
  case WM_ERASEBKGND:return 1;
  case WM_PAINT:{PAINTSTRUCT ps;HDC dc=BeginPaint(window,&ps);RECT r{};GetClientRect(window,&r);RECT toolbar{0,0,r.right,cef::toolbarHeight};FillRect(dc,&toolbar,s->background);if(s->w&&s->h){BITMAPINFO info{};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);info.bmiHeader.biWidth=s->w;info.bmiHeader.biHeight=-LONG(s->h);info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;StretchDIBits(dc,0,cef::toolbarHeight,r.right,r.bottom-cef::toolbarHeight,0,0,s->w,s->h,s->pixels.data(),&info,DIB_RGB_COLORS,SRCCOPY);}else{RECT browser{0,cef::toolbarHeight,r.right,r.bottom};FillRect(dc,&browser,s->background);}EndPaint(window,&ps);return 0;}
  case WM_DESTROY:KillTimer(window,1);return 0;
  }return DefWindowProcW(window,message,wp,lp);
 }
};
}
BridgeView::BridgeView(Bridge& b):owner(b){owner.addRef();rect=ViewRect(0,0,1240,860);}
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
