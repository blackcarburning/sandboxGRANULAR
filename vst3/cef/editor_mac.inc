// AppKit display and input only; CEF and its NSApplication live in the helper.
@interface MGCefSurface010 : NSView {
@public mygrain::Bridge* owner;
 NSTimer* pulse;NSTextField* status;uint32_t frame,width,height;
 std::vector<uint8_t> pixels;NSTrackingArea* tracking;
}
- (void)tick:(NSTimer*)timer;
- (void)action:(NSButton*)button;
@end
@implementation MGCefSurface010
- (BOOL)isFlipped{return YES;}
- (BOOL)acceptsFirstResponder{return YES;}
- (void)updateTrackingAreas{[super updateTrackingAreas];if(tracking){[self removeTrackingArea:tracking];[tracking release];}tracking=[[NSTrackingArea alloc] initWithRect:self.bounds options:NSTrackingMouseMoved|NSTrackingActiveInKeyWindow|NSTrackingInVisibleRect owner:self userInfo:nil];[self addTrackingArea:tracking];}
- (void)action:(NSButton*)button{auto& e=owner->engine;switch(button.tag){case 101:owner->embedded.ipc.push({mygrain::cef::Reload});break;case 102:e.remote.request(5);break;case 104:e.requestStop();break;case 106:e.requestArm();break;case 220:e.remote.request(11,0,!e.remote.get().companion.autoStore);break;}}
- (void)tick:(NSTimer*)timer{
 (void)timer;auto& session=owner->embedded;
 if(!session.attempted&&owner->server&&owner->server->port()){
  NSBundle* bundle=[NSBundle bundleForClass:[MGCefSurface010 class]];
  NSString* helper=[bundle.resourcePath stringByAppendingPathComponent:@"MyGrainCEF.app/Contents/MacOS/MyGrainCEF"];
  session.start(helper.fileSystemRepresentation,owner->server->url());session.resize(self.bounds.size.width,self.bounds.size.height-68);session.visible(true);
 }
 auto* shared=session.ipc.data;if(shared&&frame!=shared->frame.load()){uint32_t w=0,h=0;if(session.ipc.copy(pixels,w,h)){width=w;height=h;frame=shared->frame.load();[self setNeedsDisplay:YES];}}
 auto remote=owner->engine.remote.get();std::string text=!session.error.empty()?session.error:session.attempted&&!session.running()?"CEF stopped. Reload the plugin instance; the last completed snapshot is retained.":!owner->engine.connected.load()?"Loading MyGrain CEF. Sign in, then Start MYGRAIN if requested.":remote.companion.supported?remote.companion.text:remote.text;
 if(remote.companion.supported)text+=" | Auto-save "+std::string(remote.companion.autoStore?"On":"Off")+" / "+std::to_string(remote.companion.interval)+"s | "+std::to_string(remote.companion.count)+" stores";
 NSString* label=[NSString stringWithUTF8String:text.c_str()];if(![status.stringValue isEqualToString:label])status.stringValue=label;
 for(NSView* child in self.subviews)if([child isKindOfClass:[NSButton class]]){auto* b=(NSButton*)child;if(b.tag==101)b.enabled=session.running();else if(b.tag==102||b.tag==220)b.enabled=remote.supported&&remote.ready&&!remote.busy;else if(b.tag==106)b.title=owner->engine.armed.load()?@"Armed - follow DAW":@"Arm - follow DAW";}
}
- (void)setFrameSize:(NSSize)size{[super setFrameSize:size];if(owner)owner->embedded.resize(size.width,MAX(200,size.height-68));if(status)status.frame=NSMakeRect(8,39,MAX(100,size.width-16),25);}
- (void)drawRect:(NSRect)dirty{(void)dirty;[[NSColor colorWithWhite:.09 alpha:1] setFill];NSRectFill(self.bounds);if(!width||!height)return;
 auto color=CGColorSpaceCreateDeviceRGB();auto provider=CGDataProviderCreateWithData(nullptr,pixels.data(),pixels.size(),nullptr);
 auto image=CGImageCreate(width,height,8,32,width*4,color,kCGBitmapByteOrder32Little|kCGImageAlphaPremultipliedFirst,provider,nullptr,false,kCGRenderingIntentDefault);
 NSImage* drawing=[[NSImage alloc] initWithCGImage:image size:NSMakeSize(width,height)];[drawing drawInRect:NSMakeRect(0,68,self.bounds.size.width,self.bounds.size.height-68) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1 respectFlipped:YES hints:nil];[drawing release];CGImageRelease(image);CGDataProviderRelease(provider);CGColorSpaceRelease(color);
}
- (uint32_t)modifiers:(NSEvent*)event{auto f=event.modifierFlags;uint32_t m=0;if(f&NSEventModifierFlagShift)m|=2;if(f&NSEventModifierFlagControl)m|=4;if(f&NSEventModifierFlagOption)m|=8;if(f&NSEventModifierFlagCommand)m|=128;if(f&NSEventModifierFlagCapsLock)m|=1;auto b=[NSEvent pressedMouseButtons];if(b&1)m|=16;if(b&2)m|=64;if(b&4)m|=32;return m;}
- (void)mouse:(NSEvent*)event type:(mygrain::cef::EventType)type{
 NSPoint point=[self convertPoint:event.locationInWindow fromView:nil];if(point.y<68&&type!=mygrain::cef::Up)return;
 if(type==mygrain::cef::Down)[self.window makeFirstResponder:self];const int button=event.buttonNumber==1?2:event.buttonNumber==2?1:0;
 owner->embedded.ipc.push({type,int(point.x),int(point.y-68),button,int(event.clickCount),[self modifiers:event]});
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
- (void)scrollWheel:(NSEvent*)e{auto p=[self convertPoint:e.locationInWindow fromView:nil];const double scale=e.hasPreciseScrollingDeltas?1:40;owner->embedded.ipc.push({mygrain::cef::Wheel,int(p.x),int(p.y-68),int(e.scrollingDeltaX*scale),int(e.scrollingDeltaY*scale),[self modifiers:e]});}
- (BOOL)becomeFirstResponder{owner->embedded.ipc.push({mygrain::cef::Focus,0,0,1});return YES;}
- (BOOL)resignFirstResponder{owner->embedded.ipc.push({mygrain::cef::Focus});return YES;}
- (void)key:(NSEvent*)e up:(BOOL)up{
 int key=0;NSString* chars=e.charactersIgnoringModifiers;
 if(chars.length){unichar c=[chars characterAtIndex:0];if(c>='a'&&c<='z')key=c-32;else if(c<128)key=c;else if(c==NSLeftArrowFunctionKey)key=37;else if(c==NSUpArrowFunctionKey)key=38;else if(c==NSRightArrowFunctionKey)key=39;else if(c==NSDownArrowFunctionKey)key=40;else if(c==NSDeleteCharacter)key=8;else if(c==NSDeleteFunctionKey)key=46;else if(c==NSHomeFunctionKey)key=36;else if(c==NSEndFunctionKey)key=35;}
 owner->embedded.ipc.push({up?mygrain::cef::KeyUp:mygrain::cef::KeyDown,0,0,key,int(e.keyCode),[self modifiers:e]});
 if(!up&&!(e.modifierFlags&(NSEventModifierFlagCommand|NSEventModifierFlagControl))){for(NSUInteger i=0;i<e.characters.length;i++){unichar c=[e.characters characterAtIndex:i];if(c<0xf700)owner->embedded.ipc.push({mygrain::cef::Char,0,0,int(c),int(e.keyCode),[self modifiers:e]});}}
}
- (void)keyDown:(NSEvent*)e{[self key:e up:NO];}
- (void)keyUp:(NSEvent*)e{[self key:e up:YES];}
- (void)dealloc{[pulse invalidate];[pulse release];if(tracking){[self removeTrackingArea:tracking];[tracking release];}[super dealloc];}
@end
namespace mygrain {
BridgeView::BridgeView(Bridge& b):owner(b){owner.addRef();rect=ViewRect(0,0,1240,824);}
BridgeView::~BridgeView(){removed();owner.release();}
tresult PLUGIN_API BridgeView::attached(void* parent,FIDString type){
 if(isPlatformTypeSupported(type)!=kResultTrue||!parent||native)return kResultFalse;owner.enable();
 auto* view=[[MGCefSurface010 alloc] initWithFrame:NSMakeRect(0,0,rect.getWidth(),rect.getHeight())];view->owner=&owner;native=view;
 NSInteger left=8;for(auto item:std::initializer_list<std::pair<int,const char*>>{{106,"Arm - follow DAW"},{104,"Stop"},{102,"Store now"},{220,"Auto-save On/Off"},{101,"Store + reload app"}}){CGFloat w=item.first==104?65:item.first==102?95:170;auto* b=[[NSButton alloc] initWithFrame:NSMakeRect(left,5,w,28)];b.title=[NSString stringWithUTF8String:item.second];b.tag=item.first;b.target=view;b.action=@selector(action:);b.bezelStyle=NSBezelStyleRounded;[view addSubview:b];[b release];left+=w+6;}
 view->status=[NSTextField labelWithString:@"Loading MyGrain CEF..."];view->status.frame=NSMakeRect(8,39,1210,25);view->status.textColor=NSColor.whiteColor;view->status.font=[NSFont systemFontOfSize:11];[view addSubview:view->status];
 view->pulse=[[NSTimer scheduledTimerWithTimeInterval:1./30 target:view selector:@selector(tick:) userInfo:nil repeats:YES] retain];[(NSView*)parent addSubview:view];owner.embedded.visible(true);return CPluginView::attached(parent,type);
}
tresult PLUGIN_API BridgeView::removed(){if(native){auto* view=(MGCefSurface010*)native;native=nullptr;owner.embedded.visible(false);[view->pulse invalidate];[view removeFromSuperview];[view release];}return CPluginView::removed();}
tresult PLUGIN_API BridgeView::onSize(ViewRect* size){if(!size)return kInvalidArgument;rect=*size;if(native)[(NSView*)native setFrameSize:NSMakeSize(rect.getWidth(),rect.getHeight())];return kResultOk;}
}
