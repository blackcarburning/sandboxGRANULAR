// Native editor only. All drawing, resources and launch work stays off the audio thread.
namespace {
using namespace Gdiplus;
Color ink(255,236,242,250),mutedInk(255,144,162,187);
void rounded(Graphics& g,const RectF& rect,float radius,const Brush& brush,const Pen* pen=nullptr){
    GraphicsPath path;const float d=radius*2;
    path.AddArc(rect.X,rect.Y,d,d,180,90);path.AddArc(rect.GetRight()-d,rect.Y,d,d,270,90);
    path.AddArc(rect.GetRight()-d,rect.GetBottom()-d,d,d,0,90);path.AddArc(rect.X,rect.GetBottom()-d,d,d,90,90);path.CloseFigure();
    g.FillPath(&brush,&path);if(pen)g.DrawPath(pen,&path);
}
void words(Graphics& g,const wchar_t* text,float x,float y,float width,float size,Color color,bool bold=false,bool center=false){
    FontFamily requested(L"Segoe UI");
    const auto* family=requested.GetLastStatus()==Ok?&requested:FontFamily::GenericSansSerif();
    Font font(family,size,bold?FontStyleBold:FontStyleRegular,UnitPixel);SolidBrush brush(color);
    StringFormat format;format.SetFormatFlags(StringFormatFlagsNoWrap);format.SetTrimming(StringTrimmingEllipsisCharacter);
    if(center)format.SetAlignment(StringAlignmentCenter);
    RectF rect(x,y,width,size*1.65f);g.DrawString(text,-1,&font,rect,&format,&brush);
}
std::wstring wideText(const std::string& text){if(text.empty())return {};int n=MultiByteToWideChar(CP_UTF8,0,text.data(),int(text.size()),nullptr,0);std::wstring out(n,L' ');MultiByteToWideChar(CP_UTF8,0,text.data(),int(text.size()),out.data(),n);return out;}
void playGlyph(Graphics& g,float x,float y,float scale,Color color,bool stop){
    SolidBrush brush(color);
    if(stop){g.FillRectangle(&brush,x,y,scale,scale);return;}
    PointF points[]={{x,y},{x,y+scale},{x+scale*.85f,y+scale*.5f}};g.FillPolygon(&brush,points,3);
}
}
BridgeView::BridgeView(Bridge& b):owner(b){
    owner.addRef();rect=ViewRect(0,0,780,756);GdiplusStartupInput input;
    if(GdiplusStartup(&graphicsToken,&input,nullptr)!=Ok){graphicsToken=0;return;}
    const auto resource=FindResourceW(ghInst,MAKEINTRESOURCEW(201),RT_RCDATA);
    const auto size=resource?SizeofResource(ghInst,resource):0;
    const void* data=resource?LockResource(LoadResource(ghInst,resource)):nullptr;
    if(size&&data){
        auto memory=GlobalAlloc(GMEM_MOVEABLE,size);
        if(memory){if(auto target=GlobalLock(memory)){std::memcpy(target,data,size);GlobalUnlock(memory);
            if(CreateStreamOnHGlobal(memory,TRUE,&logoStream)==S_OK)logo=Image::FromStream(logoStream);else GlobalFree(memory);
        }else GlobalFree(memory);}
    }
}
BridgeView::~BridgeView(){removed();delete logo;if(logoStream)logoStream->Release();if(graphicsToken)GdiplusShutdown(graphicsToken);owner.release();}
void BridgeView::launch(){
    if(!owner.server||!owner.server->port()||owner.engine.connected.load()||GetTickCount64()<launchCooldown)return;
    const std::string url=owner.server->url();const std::wstring wide(url.begin(),url.end());
    wchar_t path[2048]{};DWORD size=sizeof(path);
    LSTATUS found=RegGetValueW(HKEY_CURRENT_USER,L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",nullptr,RRF_RT_REG_SZ,nullptr,path,&size);
    if(found!=ERROR_SUCCESS){size=sizeof(path);found=RegGetValueW(HKEY_LOCAL_MACHINE,L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",nullptr,RRF_RT_REG_SZ,nullptr,path,&size);}
    HINSTANCE result=ShellExecuteW(window,L"open",found==ERROR_SUCCESS?path:L"chrome.exe",wide.c_str(),nullptr,SW_SHOWNORMAL);
    if(reinterpret_cast<INT_PTR>(result)<=32){copy();MessageBoxW(window,L"Open MYGRAIN in Chrome and paste the copied code into Windows VST3. Chrome could not be launched automatically.",L"MYGRAIN Bridge",MB_OK|MB_ICONINFORMATION);}
    else launchCooldown=GetTickCount64()+8000;
}
void BridgeView::copy(){
    if(!owner.server||!owner.server->port()||!OpenClipboard(window))return;
    const auto code=owner.server->connection();const std::wstring text(code.begin(),code.end());
    HGLOBAL memory=GlobalAlloc(GMEM_MOVEABLE,(text.size()+1)*sizeof(wchar_t));
    if(memory){auto* ptr=GlobalLock(memory);if(ptr){std::memcpy(ptr,text.c_str(),(text.size()+1)*sizeof(wchar_t));GlobalUnlock(memory);EmptyClipboard();if(!SetClipboardData(CF_UNICODETEXT,memory))GlobalFree(memory);}else GlobalFree(memory);}
    CloseClipboard();
}
void BridgeView::tick(){
    if(owner.server&&owner.server->port()){if(openPending){openPending=false;launch();}if(copyPending){copyPending=false;copy();}}
    auto& e=owner.engine;const bool connected=e.connected.load(),ready=e.browserReady.load(),armed=e.armed.load();
    const auto previousTitle=stateTitle,previousDetail=stateDetail;
    if(!owner.server){stateTitle=L"Make the connection.";stateDetail=L"Open Chrome. Your connection code is filled in and connected automatically.";}
    else if(!owner.server->port()){stateTitle=L"Starting your bridge...";stateDetail=L"Preparing a private connection on this computer.";}
    else if(!isFx&&e.project.rendered.load()&&e.preparedMode.load()){stateTitle=e.armed.load()?L"Saved Rendered loop - DAW ready":L"Saved Rendered loop - stopped";stateDetail=L"Audio is stored in the project. Open Chrome to recall the editable patch.";}
    else if(!connected){stateTitle=armed?L"Armed - waiting for Chrome":L"Waiting for Chrome";stateDetail=L"Open MYGRAIN in Chrome, or use Copy code for a manual connection.";}
    else if(!ready){stateTitle=L"Chrome connected - enabling audio";stateDetail=L"If Chrome asks, press Start MYGRAIN once. Then load your patch.";}
    else if(isFx&&e.offline.load()){stateTitle=L"Offline - delayed dry fallback";stateDetail=L"MYGRAIN FX needs real-time export. The one-second delay remains compensated.";}
    else if(isFx&&e.fx->bypass.load()){stateTitle=L"Bypassed - aligned dry signal";stateDetail=L"Disable the DAW bypass control to hear the Chrome return.";}
    else if(isFx&&e.running.load()){stateTitle=L"DAW input / Chrome FX return";stateDetail=L"1,000 ms fixed delay. Choose input routing and dry/wet in the DAW Input card.";}
    else if(isFx&&armed){stateTitle=L"Armed - buffering FX return";stateDetail=L"Keep track monitoring on. Missing returns use the time-aligned dry signal.";}
    else if(isFx){stateTitle=L"Dry - ready when you are";stateDetail=L"Green Arm enables FX. Red Stop returns to delayed dry; Chrome stays connected.";}
    else if(e.running.load()){stateTitle=e.preparedMode.load()?L"Rendered loop playing":L"Live performance";stateDetail=e.preparedMode.load()?L"Following the DAW timeline. Switch modes or refresh the render in Chrome.":L"Tweak your patch in Chrome. DAW loops keep the performance flowing.";}
    else if(e.offline.load()&&!e.preparedMode.load()){stateTitle=L"Live needs real-time playback";stateDetail=L"Choose Rendered in Chrome for an offline bounce.";}
    else if(e.armed.load()){stateTitle=L"Armed - ready for the DAW";stateDetail=e.target.load()?L"Waiting for the scheduled start. Keep the DAW processing.":L"Press Play in your DAW. Orange Play also auditions while stopped.";}
    else{stateTitle=L"Connected. Ready when you are.";stateDetail=L"Green Arm follows the DAW. Orange Play starts an audition.";}
    // Native setters invalidate owner-drawn buttons even for identical values.
    // Update only on transitions, never on every meter tick.
    auto enable=[&](int id,bool value){auto button=GetDlgItem(window,id);if(bool(IsWindowEnabled(button))!=value)EnableWindow(button,value);};
    auto label=[&](int id,const wchar_t* value){auto button=GetDlgItem(window,id);wchar_t current[128]{};GetWindowTextW(button,current,128);if(std::wcscmp(current,value)!=0)SetWindowTextW(button,value);};
    enable(101,!connected&&GetTickCount64()>=launchCooldown);enable(106,true);enable(103,(connected&&ready)||(!isFx&&e.project.rendered.load()));enable(104,connected||armed||e.project.rendered.load());
    label(101,connected?L"Chrome connected":GetTickCount64()<launchCooldown?L"Opening Chrome...":L"Open MYGRAIN in Chrome");
    label(106,armed?L"Armed - follow DAW":L"Arm - follow DAW");
    const auto nextRemote=e.remote.get();const bool patchReady=connected&&ready&&nextRemote.supported&&nextRemote.ready&&!nextRemote.busy;
    enable(201,patchReady);enable(202,patchReady);enable(203,patchReady&&!isFx&&e.preparedMode.load()&&!e.playing.load());enable(204,patchReady&&!e.playing.load());
    for(unsigned i=0;i<remoteLayerCount;i++){enable(300+i,patchReady&&(nextRemote.available&(1u<<i)));if((remoteDisplay.enabled^nextRemote.enabled)&(1u<<i))InvalidateRect(GetDlgItem(window,300+i),nullptr,FALSE);}
    if(remoteDisplay.text!=nextRemote.text||remoteDisplay.busy!=nextRemote.busy||remoteDisplay.done!=nextRemote.done||remoteDisplay.total!=nextRemote.total||remoteDisplay.warnings!=nextRemote.warnings){RECT area{24,398,756,456};InvalidateRect(window,&area,FALSE);}remoteDisplay=nextRemote;
    const uint32_t flags=uint32_t(connected)|(uint32_t(e.preparedMode.load())<<1);
    if(isFx){RECT area{620,87,755,118};static_cast<void>(area);const float pl=e.fx->inputLeft.load(),pr=e.fx->inputRight.load();const int code=int(std::clamp(pl,0.f,1.f)*130)+int(std::clamp(pr,0.f,1.f)*130)*256;if(code!=inputMeterCode){inputMeterCode=code;InvalidateRect(window,&area,FALSE);}}
    if(displayFlags==UINT32_MAX)InvalidateRect(window,nullptr,FALSE);
    else {
        if((displayFlags^flags)&2){RECT area{628,37,758,72};InvalidateRect(window,&area,FALSE);}
        if(previousTitle!=stateTitle||previousDetail!=stateDetail||((displayFlags^flags)&1)){RECT area{24,660,758,715};InvalidateRect(window,&area,FALSE);}
    }
    displayFlags=flags;
    displayLeft=std::max(owner.peakLeft.load(),displayLeft*.82f);displayRight=std::max(owner.peakRight.load(),displayRight*.82f);
    auto pixels=[](float peak){return int(std::lround(130*std::clamp((20.f*std::log10(std::max(.00001f,peak))+60.f)/60.f,0.f,1.f)));};
    const int left=pixels(displayLeft),right=pixels(displayRight);
    if(left!=meterLeftPixels||right!=meterRightPixels){meterLeftPixels=left;meterRightPixels=right;RECT area{620,664,755,686};InvalidateRect(window,&area,FALSE);}
}
void BridgeView::paint(HDC dc){
    Bitmap buffer(780,756,PixelFormat32bppPARGB);Graphics g(&buffer);g.SetSmoothingMode(SmoothingModeAntiAlias);g.SetTextRenderingHint(TextRenderingHintClearTypeGridFit);
    LinearGradientBrush background(Point(0,0),Point(780,756),Color(255,12,17,28),Color(255,22,30,48));g.FillRectangle(&background,0,0,780,756);
    SolidBrush glow(Color(16,50,225,190));g.FillEllipse(&glow,-70,-120,440,300);
    if(logo&&logo->GetLastStatus()==Ok){g.SetInterpolationMode(InterpolationModeHighQualityBicubic);g.DrawImage(logo,RectF(24,18,104,104));}
    words(g,L"MYGRAIN",143,25,410,41,ink,true);words(g,isFx?L"F X   /   D A W  +  C H R O M E  +  D A W":L"B R I D G E   /   C H R O M E  +  D A W",147,79,440,12,mutedInk);
    SolidBrush chip(Color(255,31,44,65));Pen outline(Color(255,49,67,92));rounded(g,RectF(630,39,126,30),15,chip,&outline);
    words(g,isFx?L"STEREO FX":owner.engine.preparedMode.load()?L"RENDERED":L"LIVE LINK",635,44,116,12,Color(255,141,221,222),true,true);
    SolidBrush panel(Color(255,23,33,50));Pen edge(Color(255,43,59,82));rounded(g,RectF(24,108,732,94),16,panel,&edge);
    words(g,L"YOUR CHROME CONNECTION",44,116,480,11,mutedInk,true);
    words(g,L"Code-filled. Connected. Keep creating.",44,132,680,14,ink);
    rounded(g,RectF(24,214,732,100),16,panel,&edge);words(g,isFx?L"EFFECT CONTROL":L"TRANSPORT",44,218,480,11,mutedInk,true);
    words(g,isFx?L"ENABLE / RETAIN ARM":L"ARM / FOLLOW DAW",48,296,215,10,mutedInk,false,true);words(g,L"STOP / DISARM",282,296,215,10,mutedInk,false,true);words(g,isFx?L"ENABLE / AUDITION":L"PLAY / AUDITION",516,296,215,10,mutedInk,false,true);
    rounded(g,RectF(24,326,732,60),14,panel,&edge);words(g,L"NEW PATCH / REPLACES CURRENT · UNDO IN CHROME",44,332,680,9,mutedInk,true);
    rounded(g,RectF(24,398,732,58),12,panel,&edge);
    const auto remote=owner.engine.remote.get();const auto progress=wideText(remote.text);
    FontFamily family(L"Segoe UI");Font font(&family,12,FontStyleRegular,UnitPixel);SolidBrush text(ink);StringFormat format;format.SetTrimming(StringTrimmingEllipsisCharacter);RectF progressArea(40,407,700,29);g.DrawString(progress.c_str(),-1,&font,progressArea,&format,&text);
    std::wstring counts=remote.total?std::to_wstring(remote.done)+L" / "+std::to_wstring(remote.total)+L" layer jobs finished":remote.busy?L"Working...":L"Ready when Chrome is connected";
    if(remote.warnings)counts+=L" · "+std::to_wstring(remote.warnings)+L" warnings";words(g,counts.c_str(),40,438,695,10,mutedInk);
    if(remote.total){SolidBrush bar(Color(255,93,204,191));g.FillRectangle(&bar,40.f,452.f,700.f*remote.done/remote.total,2.f);}
    rounded(g,RectF(24,468,732,184),14,panel,&edge);words(g,L"LAYERS / LIT = ON · DARK = MUTED",44,479,690,10,mutedInk,true);
    const bool connected=owner.engine.connected.load();SolidBrush led(connected?Color(255,80,230,164):Color(255,111,130,158));g.FillEllipse(&led,28,670,8,8);
    words(g,stateTitle.c_str(),46,664,550,19,ink,true);words(g,stateDetail.c_str(),28,694,710,12,mutedInk);
    const float meters[]={displayLeft,displayRight};for(int ch=0;ch<2;++ch){SolidBrush trough(Color(255,34,49,69));rounded(g,RectF(622,666+ch*11,130,6),3,trough);
        float level=std::clamp((20.f*std::log10(std::max(.00001f,meters[ch]))+60.f)/60.f,0.f,1.f);LinearGradientBrush bar(Point(622,0),Point(752,0),Color(255,49,221,159),Color(255,240,184,78));if(level>0)rounded(g,RectF(622,666+ch*11,std::max(6.f,130*level),6),3,bar);}
    if(isFx){const float peaks[]={owner.engine.fx->inputLeft.load(),owner.engine.fx->inputRight.load()};SolidBrush inputBar(Color(255,80,214,211));for(int ch=0;ch<2;ch++){SolidBrush trough(Color(255,34,49,69));g.FillRectangle(&trough,622,90+ch*9,130,5);g.FillRectangle(&inputBar,622,90+ch*9,int(130*std::clamp(peaks[ch],0.f,1.f)),5);}words(g,L"STEREO IN",622,105,130,8,mutedInk,false,true);}
    words(g,L"STEREO OUT",623,690,130,9,mutedInk,false,true);
    Pen divider(Color(255,44,58,78));g.DrawLine(&divider,28,718,752,718);
    words(g,isFx?L"WINDOWS VST3 FX   /   0.3.0 PREVIEW":L"WINDOWS VST3   /   0.7.0 PREVIEW",28,732,345,10,mutedInk);
    words(g,isFx?L"1,000 ms / aligned dry + wet":L"Live edits. Rendered precision.",407,732,205,11,mutedInk,false,true);
    Graphics target(dc);target.DrawImage(&buffer,0,0);
}
void BridgeView::paintButton(DRAWITEMSTRUCT* item){
    const int id=int(item->CtlID);Bitmap buffer(item->rcItem.right,item->rcItem.bottom,PixelFormat32bppPARGB);Graphics g(&buffer);g.SetSmoothingMode(SmoothingModeAntiAlias);g.SetTextRenderingHint(TextRenderingHintClearTypeGridFit);
    SolidBrush backdrop(id==105?Color(255,22,30,48):Color(255,23,33,50));g.FillRectangle(&backdrop,0,0,item->rcItem.right,item->rcItem.bottom);
    RectF area(1,1,float(item->rcItem.right-item->rcItem.left-2),float(item->rcItem.bottom-item->rcItem.top-2));const bool enabled=!(item->itemState&ODS_DISABLED),down=item->itemState&ODS_SELECTED;
    Color top(255,37,56,80),bottom(255,27,43,65),border(255,69,98,127),text=ink;
    if(id==106){top=Color(255,27,113,80);bottom=Color(255,18,74,55);border=Color(255,65,229,162);}
    if(id==104){top=Color(255,139,44,62);bottom=Color(255,87,26,43);border=Color(255,248,108,126);}
    if(id==103){top=Color(255,158,99,31);bottom=Color(255,103,58,24);border=Color(255,255,192,90);}
    if(id==201){top=Color(255,83,66,138);bottom=Color(255,51,38,94);border=Color(255,176,146,240);}
    if(id==202){top=Color(255,134,48,104);bottom=Color(255,79,30,69);border=Color(255,240,128,190);}
    if(id>=300&&id<300+int(remoteLayerCount)){const bool on=owner.engine.remote.get().enabled&(1u<<(id-300));if(on){top=Color(255,28,98,91);bottom=Color(255,18,61,62);border=Color(255,88,220,193);}else{top=Color(255,28,35,50);bottom=Color(255,20,28,41);border=Color(255,58,72,94);}}
    if(!enabled){top=Color(255,31,42,58);bottom=Color(255,25,35,50);border=Color(255,51,65,83);text=Color(255,116,133,154);}
    if(down){top=bottom;}
    LinearGradientBrush fill(PointF(0,0),PointF(0,area.Height),top,bottom);Pen edge(border,1.2f);rounded(g,area,10,fill,&edge);
    wchar_t label[128]{};GetWindowTextW(item->hwndItem,label,128);
    if(id==103||id==104||id==106){playGlyph(g,27,16,18,text,id==104);const wchar_t* title=id==106?(owner.engine.armed.load()?L"ARMED":L"ARM"):id==104?L"STOP":L"PLAY";words(g,title,58,12,area.Width-76,18,text,true,true);}
    else words(g,label,8,std::max(3.f,(area.Height-18)/2),area.Width-16,id>=300?11:12,text,true,true);
    if(item->itemState&ODS_FOCUS){Pen focus(Color(255,205,224,247),1);focus.SetDashStyle(DashStyleDot);SolidBrush transparent(Color(0,0,0,0));rounded(g,RectF(5,5,area.Width-8,area.Height-8),7,transparent,&focus);}
    Graphics target(item->hDC);target.DrawImage(&buffer,0,0);
}
LRESULT CALLBACK BridgeView::windowProc(HWND hwnd,UINT msg,WPARAM w,LPARAM l){
    auto* self=reinterpret_cast<BridgeView*>(GetWindowLongPtr(hwnd,GWLP_USERDATA));
    if(msg==WM_NCCREATE){self=reinterpret_cast<BridgeView*>(((CREATESTRUCT*)l)->lpCreateParams);SetWindowLongPtr(hwnd,GWLP_USERDATA,(LONG_PTR)self);}
    if(self){
        if(msg==WM_TIMER){self->tick();return 0;}
        if(msg==WM_DRAWITEM){self->paintButton(reinterpret_cast<DRAWITEMSTRUCT*>(l));return TRUE;}
        if(msg==WM_COMMAND){const unsigned id=LOWORD(w);if(id>=300&&id<300+remoteLayerCount){auto state=self->owner.engine.remote.get();self->owner.engine.remote.request(3,id-300,!(state.enabled&(1u<<(id-300))));return 0;}switch(id){
            case 201:self->owner.engine.remote.request(1);return 0;
            case 202:self->owner.engine.remote.request(2);return 0;
            case 203:self->owner.engine.remote.request(4);return 0;
            case 204:self->owner.engine.remote.request(5);return 0;
            case 101:if(!self->owner.engine.connected.load()){try{self->owner.enable();self->openPending=true;self->tick();}catch(...){MessageBoxW(hwnd,L"The local bridge could not start.",L"MYGRAIN",MB_OK);}}return 0;
            case 102:try{self->owner.enable();self->copyPending=true;self->tick();}catch(...){}return 0;
            case 106:self->owner.engine.requestArm();return 0;
            case 103:if((self->owner.engine.connected.load()&&self->owner.engine.browserReady.load())||self->owner.engine.project.rendered.load())self->owner.engine.requestStart();return 0;
            case 104:self->owner.engine.requestStop();return 0;
            case 105:self->owner.engine.browserReady.store(false);self->owner.engine.connected.store(false);self->owner.engine.requestPause();return 0;
        }}
        if(msg==WM_ERASEBKGND)return 1;
        if(msg==WM_PAINT){PAINTSTRUCT ps;auto dc=BeginPaint(hwnd,&ps);self->paint(dc);EndPaint(hwnd,&ps);return 0;}
        if(msg==WM_PRINTCLIENT){self->paint(reinterpret_cast<HDC>(w));return 0;}
    }
    return DefWindowProc(hwnd,msg,w,l);
}
tresult PLUGIN_API BridgeView::attached(void* parent,FIDString type){
    if(!parent||isPlatformTypeSupported(type)!=kResultTrue)return kResultFalse;
    WNDCLASSW cls{};cls.lpfnWndProc=windowProc;cls.hInstance=ghInst;cls.lpszClassName=isFx?L"MYGRAINFXView010":L"MYGRAINBridgeView010";cls.hCursor=LoadCursor(nullptr,IDC_ARROW);RegisterClassW(&cls);
    displayFlags=UINT32_MAX;meterLeftPixels=meterRightPixels=-1;
    window=CreateWindowExW(0,cls.lpszClassName,isFx?L"MYGRAIN FX":L"MYGRAIN Bridge",WS_CHILD|WS_VISIBLE|WS_CLIPCHILDREN,0,0,780,756,(HWND)parent,nullptr,ghInst,this);if(!window)return kResultFalse;
    auto button=[&](const wchar_t* label,int id,int x,int y,int width,int height){CreateWindowExW(0,L"BUTTON",label,WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,x,y,width,height,window,(HMENU)(INT_PTR)id,ghInst,nullptr);};
    button(L"Open MYGRAIN in Chrome",101,44,152,340,34);button(L"Copy code / manual connection",102,400,152,336,34);
    button(L"Arm - follow DAW",106,44,242,220,50);button(L"Stop - disarm",104,278,242,220,50);button(L"Play - audition",103,512,242,220,50);
    button(L"Disconnect",105,634,726,116,26);
    button(L"Sparse Random",201,40,348,166,30);button(L"Mega Random",202,218,348,166,30);button(L"Refresh render",203,396,348,166,30);button(L"Store in project",204,574,348,166,30);
    for(unsigned i=0;i<remoteLayerCount;i++){const auto name=wideText(remoteLayerNames[i]);button(name.c_str(),300+i,40+(i%5)*142,500+(i/5)*30,132,26);}
    SetTimer(window,1,100,nullptr);systemWindow=parent;tick();return kResultOk;
}
tresult PLUGIN_API BridgeView::removed(){if(window){KillTimer(window,1);DestroyWindow(window);window=nullptr;}systemWindow=nullptr;return kResultOk;}
