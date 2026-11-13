#ifdef MYGRAIN_FX
// Objective-C classes are process-global; coexist with the CEF instrument.
#define MGCefToolbarButton MGCEFFXToolbarButton
#define MGCefSurface010 MGCEFFXSurface010
#endif
// AppKit display and input only; CEF and its NSApplication live in the helper.
static NSColor* mgToolbarColor(unsigned rgb){return [NSColor colorWithSRGBRed:((rgb>>16)&255)/255. green:((rgb>>8)&255)/255. blue:(rgb&255)/255. alpha:1];}
@interface MGCefToolbarButton : NSButton
@property(nonatomic) BOOL active;
@end
@implementation MGCefToolbarButton
- (void)setActive:(BOOL)value{if(_active!=value){_active=value;[self setNeedsDisplay:YES];}}
- (void)drawRect:(NSRect)dirty{
 (void)dirty;unsigned top=0x205273,bottom=0x12334f,edge=0x6797b8,ink=0xf0f8ff;
 if(self.active){top=0x1d6459;bottom=0x124338;edge=0x85e3c6;}
 if(self.tag==104){top=0x7d1731;bottom=0x501628;edge=0xe07a93;}
 if(!self.enabled){top=bottom=0x182b3e;edge=0x4f6379;ink=0x97abc0;}
 if(self.highlighted)top=bottom;
 NSBezierPath* path=[NSBezierPath bezierPathWithRoundedRect:NSInsetRect(self.bounds,1,1) xRadius:9 yRadius:9];NSGradient* fill=[[NSGradient alloc] initWithStartingColor:mgToolbarColor(top) endingColor:mgToolbarColor(bottom)];[fill drawInBezierPath:path angle:90];[fill release];
 [mgToolbarColor(edge) setStroke];path.lineWidth=self.window.firstResponder==self?2.4:1.2;[path stroke];
 NSDictionary* attrs=@{NSFontAttributeName:[NSFont systemFontOfSize:self.bounds.size.width<100?11:12 weight:NSFontWeightSemibold],NSForegroundColorAttributeName:mgToolbarColor(ink)};NSSize size=[self.title sizeWithAttributes:attrs];[self.title drawInRect:NSMakeRect((self.bounds.size.width-size.width)/2,(self.bounds.size.height-size.height)/2,size.width,size.height) withAttributes:attrs];
}
@end
@interface MGCefSurface010 : NSView {
@public mygrain::Bridge* owner;
 NSTimer* pulse;NSTextField* status;NSTextField* details;NSTextField* interval;uint32_t frame,width,height,displayedInterval;
 std::vector<uint8_t> pixels;NSTrackingArea* tracking;BOOL hostKeyboard,focused;mygrain::cef::SpaceKey space;
}
- (void)tick:(NSTimer*)timer;
- (void)action:(NSControl*)button;
- (void)layoutToolbar;
@end
@implementation MGCefSurface010
- (BOOL)isFlipped{return YES;}
- (BOOL)acceptsFirstResponder{return YES;}
- (void)updateTrackingAreas{[super updateTrackingAreas];if(tracking){[self removeTrackingArea:tracking];[tracking release];}tracking=[[NSTrackingArea alloc] initWithRect:self.bounds options:NSTrackingMouseMoved|NSTrackingActiveInKeyWindow|NSTrackingInVisibleRect owner:self userInfo:nil];[self addTrackingArea:tracking];}
- (void)layoutToolbar{double left=12,scale=mygrain::cef::toolbarScale(self.bounds.size.width);for(auto item:mygrain::cef::toolbarItems){NSView* control=[self viewWithTag:item.id];control.frame=NSMakeRect(left,8,item.width*scale,36);left+=(item.width+8)*scale;}status.frame=NSMakeRect(12,51,MAX(100,self.bounds.size.width-24),21);details.frame=NSMakeRect(12,74,MAX(100,self.bounds.size.width-24),21);}
- (void)action:(NSControl*)button{auto& e=owner->engine;switch(button.tag){case 101:owner->embedded.ipc.push({mygrain::cef::Reload});break;case 102:e.remote.request(5);break;case 104:e.requestStop();break;case 106:e.requestArm();break;case 220:e.remote.request(11,0,!e.remote.get().companion.autoStore);break;case 221:case 222:{NSScanner* scan=[NSScanner scannerWithString:interval.stringValue];NSInteger seconds=0;if([scan scanInteger:&seconds]&&scan.isAtEnd&&seconds>=15&&seconds<=3600)e.remote.request(12,0,uint32_t(seconds));else{status.stringValue=@"Choose an automatic-save interval from 15 to 3600 seconds.";interval.integerValue=e.remote.get().companion.interval;}break;}}}
- (void)tick:(NSTimer*)timer{
 (void)timer;auto& session=owner->embedded;
 if(!session.attempted&&owner->server&&owner->server->port()){
  NSBundle* bundle=[NSBundle bundleForClass:[MGCefSurface010 class]];
  NSString* helper=[bundle.resourcePath stringByAppendingPathComponent:@"MyGrainCEF.app/Contents/MacOS/MyGrainCEF"];
  session.start(helper.fileSystemRepresentation,owner->server->url());session.resize(self.bounds.size.width,self.bounds.size.height-mygrain::cef::toolbarHeight);session.visible(true);
 }
 auto* shared=session.ipc.data;if(shared&&frame!=shared->frame.load()){uint32_t w=0,h=0;if(session.ipc.copy(pixels,w,h)){width=w;height=h;frame=shared->frame.load();[self setNeedsDisplayInRect:NSMakeRect(0,mygrain::cef::toolbarHeight,self.bounds.size.width,self.bounds.size.height-mygrain::cef::toolbarHeight)];}}
 auto remote=owner->engine.remote.get();std::string text=!session.error.empty()?session.error:session.attempted&&!session.running()?"CEF stopped. Reload the plugin instance; the last completed snapshot is retained.":!owner->engine.connected.load()?"Loading MyGrain CEF. Sign in, then Start MYGRAIN if requested.":mygrain::cef::toolbarActivity(remote,owner->engine.armed.load(),owner->engine.playing.load());

 NSString* label=[NSString stringWithUTF8String:text.c_str()];if(![status.stringValue isEqualToString:label])status.stringValue=label;
 auto stats=mygrain::cef::toolbarStats(remote.companion);NSString* statLabel=[NSString stringWithUTF8String:stats.c_str()];if(![details.stringValue isEqualToString:statLabel]){details.stringValue=statLabel;details.toolTip=statLabel;}status.toolTip=label;
 const bool ready=remote.supported&&remote.ready&&!remote.busy;
 for(NSView* child in self.subviews)if([child isKindOfClass:[MGCefToolbarButton class]]){auto* b=(MGCefToolbarButton*)child;if(b.tag==101)b.enabled=session.running();else if(b.tag==102||b.tag==220||b.tag==222)b.enabled=ready;if(b.tag==106){b.title=owner->engine.armed.load()?@"Armed - follow DAW":@"Arm - follow DAW";b.active=owner->engine.armed.load();}if(b.tag==220){b.title=remote.companion.autoStore?@"Auto-save: On":@"Auto-save: Off";b.active=remote.companion.autoStore;}}
 interval.enabled=ready;if(self.window.firstResponder!=interval.currentEditor&&displayedInterval!=remote.companion.interval){displayedInterval=remote.companion.interval;interval.integerValue=remote.companion.interval;}
}
- (void)setFrameSize:(NSSize)size{[super setFrameSize:size];if(owner)owner->embedded.resize(size.width,MAX(200,size.height-mygrain::cef::toolbarHeight));if(status)[self layoutToolbar];}
- (void)drawRect:(NSRect)dirty{[mgToolbarColor(0x101621) setFill];NSRectFill(NSIntersectionRect(dirty,NSMakeRect(0,0,self.bounds.size.width,mygrain::cef::toolbarHeight)));if(!width||!height){NSRectFill(dirty);return;}
 auto color=CGColorSpaceCreateDeviceRGB();auto provider=CGDataProviderCreateWithData(nullptr,pixels.data(),pixels.size(),nullptr);
 auto image=CGImageCreate(width,height,8,32,width*4,color,kCGBitmapByteOrder32Little|kCGImageAlphaPremultipliedFirst,provider,nullptr,false,kCGRenderingIntentDefault);
 NSImage* drawing=[[NSImage alloc] initWithCGImage:image size:NSMakeSize(width,height)];[drawing drawInRect:NSMakeRect(0,mygrain::cef::toolbarHeight,self.bounds.size.width,self.bounds.size.height-mygrain::cef::toolbarHeight) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1 respectFlipped:YES hints:nil];[drawing release];CGImageRelease(image);CGDataProviderRelease(provider);CGColorSpaceRelease(color);
}
- (uint32_t)modifiers:(NSEvent*)event{auto f=event.modifierFlags;uint32_t m=0;if(f&NSEventModifierFlagShift)m|=2;if(f&NSEventModifierFlagControl)m|=4;if(f&NSEventModifierFlagOption)m|=8;if(f&NSEventModifierFlagCommand)m|=128;if(f&NSEventModifierFlagCapsLock)m|=1;auto b=[NSEvent pressedMouseButtons];if(b&1)m|=16;if(b&2)m|=64;if(b&4)m|=32;return m;}
- (void)mouse:(NSEvent*)event type:(mygrain::cef::EventType)type{
 NSPoint point=[self convertPoint:event.locationInWindow fromView:nil];if(point.y<mygrain::cef::toolbarHeight&&type!=mygrain::cef::Up)return;
 if(type==mygrain::cef::Down){[self.window makeFirstResponder:self];owner->embedded.ipc.push({mygrain::cef::Focus,0,0,1});}const int button=event.buttonNumber==1?2:event.buttonNumber==2?1:0;
 owner->embedded.ipc.push({type,int(point.x),int(point.y-mygrain::cef::toolbarHeight),button,int(event.clickCount),[self modifiers:event]});
}
- (void)mouseMoved:(NSEvent*)e{[self mouse:e type:mygrain::cef::Move];}
- (void)mouseDragged:(NSEvent*)e{[self mouse:e type:mygrain::cef::Move];}
- (void)rightMouseDragged:(NSEvent*)e{[self mouse:e type:mygrain::cef::Move];}
- (void)mouseDown:(NSEvent*)e{[self mouse:e type:mygrain::cef::Down];}
- (void)mouseUp:(NSEvent*)e{[self mouse:e type:mygrain::cef::Up];}
- (void)rightMouseDown:(NSEvent*)e{[self mouse:e type:mygrain::cef::Down];}
- (void)rightMouseUp:(NSEvent*)e{[self mouse:e type:mygrain::cef::Up];}
- (void)otherMouseDown:(NSEvent*)e{[self mouse:e type:mygrain::cef::Down];}
- (void)otherMouseUp:(NSEvent*)e{[self mouse:e type:mygrain::cef::Up];}
- (void)scrollWheel:(NSEvent*)e{auto p=[self convertPoint:e.locationInWindow fromView:nil];const double scale=e.hasPreciseScrollingDeltas?1:40;owner->embedded.ipc.push({mygrain::cef::Wheel,int(p.x),int(p.y-mygrain::cef::toolbarHeight),int(e.scrollingDeltaX*scale),int(e.scrollingDeltaY*scale),[self modifiers:e]});}
- (BOOL)becomeFirstResponder{focused=YES;owner->embedded.ipc.push({mygrain::cef::Focus,0,0,1});return YES;}
- (BOOL)resignFirstResponder{focused=NO;hostKeyboard=NO;space={};owner->embedded.ipc.push({mygrain::cef::Focus});return YES;}
- (void)key:(NSEvent*)e up:(BOOL)up{
 if(hostKeyboard)return;int key=0;NSString* chars=e.charactersIgnoringModifiers;
 if(chars.length){unichar c=[chars characterAtIndex:0];if(c>='a'&&c<='z')key=c-32;else if(c==NSDeleteCharacter)key=8;else if(c<128)key=c;else if(c==NSLeftArrowFunctionKey)key=37;else if(c==NSUpArrowFunctionKey)key=38;else if(c==NSRightArrowFunctionKey)key=39;else if(c==NSDownArrowFunctionKey)key=40;else if(c==NSDeleteCharacter)key=8;else if(c==NSDeleteFunctionKey)key=46;else if(c==NSHomeFunctionKey)key=36;else if(c==NSEndFunctionKey)key=35;}
 owner->embedded.ipc.push({up?mygrain::cef::KeyUp:mygrain::cef::KeyDown,int(e.characters.length?[e.characters characterAtIndex:0]:chars.length?[chars characterAtIndex:0]:0),0,key,int(e.keyCode),[self modifiers:e]});
 if(!up&&!(e.modifierFlags&(NSEventModifierFlagCommand|NSEventModifierFlagControl))){for(NSUInteger i=0;i<e.characters.length;i++){unichar c=[e.characters characterAtIndex:i];if(c<0xf700)owner->embedded.ipc.push({mygrain::cef::Char,0,0,int(c),int(e.keyCode),[self modifiers:e]});}}
}
- (void)keyDown:(NSEvent*)e{if(!hostKeyboard&&space.toHost(owner->embedded.ipc,e.keyCode==49?32:0,false)){[super keyDown:e];return;}[self key:e up:NO];}
- (void)keyUp:(NSEvent*)e{if(!hostKeyboard&&space.toHost(owner->embedded.ipc,e.keyCode==49?32:0,true)){[super keyUp:e];return;}[self key:e up:YES];}
- (void)dealloc{[pulse invalidate];[pulse release];if(tracking){[self removeTrackingArea:tracking];[tracking release];}[super dealloc];}
@end
namespace mygrain {
BridgeView::BridgeView(Bridge& b):owner(b){owner.addRef();rect=ViewRect(0,0,1240,860);}
BridgeView::~BridgeView(){removed();owner.release();}
tresult PLUGIN_API BridgeView::attached(void* parent,FIDString type){
 if(isPlatformTypeSupported(type)!=kResultTrue||!parent||native)return kResultFalse;owner.enable();
 auto* view=[[MGCefSurface010 alloc] initWithFrame:NSMakeRect(0,0,rect.getWidth(),rect.getHeight())];view->owner=&owner;view.wantsLayer=YES;view.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];native=view;
 for(auto item:mygrain::cef::toolbarItems){
  NSControl* control=nil;
  if(item.id==221){auto* field=[[NSTextField alloc] initWithFrame:NSZeroRect];field.stringValue=@"60";field.alignment=NSTextAlignmentCenter;field.font=[NSFont systemFontOfSize:13 weight:NSFontWeightSemibold];field.drawsBackground=YES;field.backgroundColor=mgToolbarColor(0x122434);field.textColor=mgToolbarColor(0xf0f8ff);field.bezelStyle=NSTextFieldRoundedBezel;field.target=view;field.action=@selector(action:);view->interval=field;control=field;[field setAccessibilityLabel:@"Automatic save interval in seconds (15 to 3600)"];}
  else if(item.id==223){control=[[NSTextField labelWithString:@"Every (s)"] retain];((NSTextField*)control).textColor=mgToolbarColor(0xa6bdd2);((NSTextField*)control).alignment=NSTextAlignmentCenter;}
  else{auto* b=[[MGCefToolbarButton alloc] initWithFrame:NSZeroRect];b.title=[NSString stringWithUTF8String:item.title];b.target=view;b.action=@selector(action:);b.bordered=NO;b.focusRingType=NSFocusRingTypeNone;control=b;}
  control.tag=item.id;[view addSubview:control];[control release];
 }
 view->interval.tag=221;
 for(int id:{230,231}){auto* label=[NSTextField labelWithString:id==230?@"Loading MyGrain CEF...":@"Automatic patch storage runs with the editor closed. Save the DAW project normally."];label.tag=id;label.textColor=mgToolbarColor(id==230?0xe1effa:0xa6bdd2);label.font=[NSFont systemFontOfSize:11];label.lineBreakMode=NSLineBreakByTruncatingTail;[view addSubview:label];if(id==230)view->status=label;else view->details=label;}
 [view layoutToolbar];
 view->pulse=[[NSTimer scheduledTimerWithTimeInterval:1./30 target:view selector:@selector(tick:) userInfo:nil repeats:YES] retain];[(NSView*)parent addSubview:view];owner.embedded.visible(true);return CPluginView::attached(parent,type);
}
tresult PLUGIN_API BridgeView::removed(){if(native){auto* view=(MGCefSurface010*)native;native=nullptr;owner.embedded.visible(false);[view->pulse invalidate];[view removeFromSuperview];[view release];}return CPluginView::removed();}
tresult PLUGIN_API BridgeView::onSize(ViewRect* size){if(!size)return kInvalidArgument;rect=*size;if(native)[(NSView*)native setFrameSize:NSMakeSize(rect.getWidth(),rect.getHeight())];return kResultOk;}
}

namespace mygrain {
tresult PLUGIN_API BridgeView::onFocus(TBool focused){
 if(!native)return kResultFalse;auto* s=(MGCefSurface010*)native;
 s->focused=focused;if(focused&&(![s.window.firstResponder isKindOfClass:[NSView class]]||![(NSView*)s.window.firstResponder isDescendantOf:s]))[s.window makeFirstResponder:s];
 if(!focused){s->hostKeyboard=NO;s->space={};}
 return owner.embedded.ipc.push({cef::Focus,0,0,focused?1:0})?kResultTrue:kResultFalse;
}
tresult PLUGIN_API BridgeView::onKeyDown(char16 key,int16 code,int16 modifiers){
 if(!native||!((MGCefSurface010*)native)->focused||[(NSView*)native window].firstResponder!=(NSView*)native)return kResultFalse;
 ((MGCefSurface010*)native)->hostKeyboard=YES;
 if(((MGCefSurface010*)native)->space.toHost(owner.embedded.ipc,cef::virtualKey(key,code),false))return kResultFalse;
 return cef::hostKey(owner.embedded.ipc,false,key,code,modifiers)?kResultTrue:kResultFalse;
}
tresult PLUGIN_API BridgeView::onKeyUp(char16 key,int16 code,int16 modifiers){
 if(!native||!((MGCefSurface010*)native)->focused||[(NSView*)native window].firstResponder!=(NSView*)native)return kResultFalse;
 if(((MGCefSurface010*)native)->space.toHost(owner.embedded.ipc,cef::virtualKey(key,code),true))return kResultFalse;
 return cef::hostKey(owner.embedded.ipc,true,key,code,modifiers)?kResultTrue:kResultFalse;
}
}
