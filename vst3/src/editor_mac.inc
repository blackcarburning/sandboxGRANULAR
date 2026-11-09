// AppKit lives exclusively on the host UI thread, never on the audio callback.
// Distinct Objective-C class names let both bundles coexist in Bitwig's process.
#ifdef MYGRAIN_FX
#define MGNativeView MYGRAINFXNativeView
#define MGArtButton MYGRAINFXArtButton
#else
#define MGNativeView MYGRAINInstrumentNativeView
#define MGArtButton MYGRAINInstrumentArtButton
#endif
@interface MGArtButton : NSButton
@end
@implementation MGArtButton
- (void)drawRect:(NSRect)dirty {
    (void)dirty;CGFloat red=.14,green=.21,blue=.30;
    if(self.tag==106){red=.08;green=.34;blue=.23;}else if(self.tag==104){red=.43;green=.12;blue=.19;}else if(self.tag==103){red=.48;green=.28;blue=.09;}
    else if(self.tag==201){red=.28;green=.19;blue=.45;}else if(self.tag==202){red=.45;green=.15;blue=.35;}
    else if(self.tag>=300){if(self.state==NSControlStateValueOn){red=.08;green=.34;blue=.30;}else{red=.08;green=.11;blue=.17;}}
    if(!self.enabled){red=.10;green=.13;blue=.18;}if(self.cell.highlighted){red*=.7;green*=.7;blue*=.7;}
    NSRect rect=NSInsetRect(self.bounds,1,1);NSBezierPath* path=[NSBezierPath bezierPathWithRoundedRect:rect xRadius:8 yRadius:8];
    NSColor* top=[NSColor colorWithSRGBRed:red+.04 green:green+.04 blue:blue+.04 alpha:1];NSColor* bottom=[NSColor colorWithSRGBRed:red green:green blue:blue alpha:1];
    NSGradient* gradient=[[[NSGradient alloc] initWithStartingColor:top endingColor:bottom] autorelease];[gradient drawInBezierPath:path angle:90];
    [[NSColor colorWithSRGBRed:red+.19 green:green+.19 blue:blue+.19 alpha:1] setStroke];path.lineWidth=1;[path stroke];
    NSMutableParagraphStyle* style=[[[NSMutableParagraphStyle alloc] init] autorelease];style.alignment=NSTextAlignmentCenter;style.lineBreakMode=NSLineBreakByTruncatingTail;
    NSDictionary* attributes=@{NSFontAttributeName:[NSFont systemFontOfSize:self.tag>=300?11:13 weight:NSFontWeightSemibold],NSForegroundColorAttributeName:self.enabled?[NSColor colorWithSRGBRed:.91 green:.95 blue:1 alpha:1]:[NSColor colorWithSRGBRed:.44 green:.51 blue:.62 alpha:1],NSParagraphStyleAttributeName:style};
    [self.title drawInRect:NSMakeRect(5,(self.bounds.size.height-17)/2,self.bounds.size.width-10,19) withAttributes:attributes];
    if(self.window.firstResponder==self){[[NSColor keyboardFocusIndicatorColor] setStroke];NSBezierPath* focus=[NSBezierPath bezierPathWithRoundedRect:NSInsetRect(rect,3,3) xRadius:6 yRadius:6];[focus stroke];}
}
@end
@interface MGNativeView : NSView {
@public
    mygrain::Bridge* bridge;
    NSTimer* timer;
    NSButton *openButton,*armButton,*playButton,*stopButton;
    NSTextField *statusLabel,*detailLabel,*remoteLabel,*remoteCount;
    NSProgressIndicator* remoteProgress;
    NSButton* layerButtons[25];
    NSButton *sparseButton,*megaButton,*renderButton,*storeButton;
    NSLevelIndicator *leftMeter,*rightMeter,*inputLeft,*inputRight;
    bool pendingOpen,pendingCopy;
    double cooldown;
}
- (void)tick:(NSTimer*)sender;
- (void)action:(NSButton*)sender;
@end
@implementation MGNativeView
- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstResponder { return YES; }
- (void)drawRect:(NSRect)dirty {
    [[NSColor colorWithSRGBRed:.045 green:.067 blue:.11 alpha:1] setFill];NSRectFill(dirty);
}
- (NSTextField*)label:(NSString*)text x:(double)x y:(double)y width:(double)w size:(double)size {
    NSTextField* label=[NSTextField labelWithString:text];label.frame=NSMakeRect(x,y,w,size*2.5);
    label.font=[NSFont systemFontOfSize:size weight:size>=20?NSFontWeightBold:NSFontWeightRegular];
    label.textColor=[NSColor colorWithSRGBRed:.89 green:.93 blue:.98 alpha:1];
    label.maximumNumberOfLines=2;label.lineBreakMode=NSLineBreakByWordWrapping;[self addSubview:label];return label;
}
- (NSButton*)button:(NSString*)text tag:(NSInteger)tag x:(double)x y:(double)y width:(double)width color:(NSColor*)color {
    NSButton* button=[MGArtButton buttonWithTitle:text target:self action:@selector(action:)];
    button.frame=NSMakeRect(x,y,width,48);button.tag=tag;button.bezelStyle=NSBezelStyleRounded;
    button.font=[NSFont systemFontOfSize:15 weight:NSFontWeightSemibold];button.bezelColor=color;
    button.controlSize=NSControlSizeLarge;if(tag==106||tag==103||tag==104)button.contentTintColor=color;
    [self addSubview:button];return button;
}
- (NSLevelIndicator*)meterX:(double)x y:(double)y {
    NSLevelIndicator* meter=[[[NSLevelIndicator alloc] initWithFrame:NSMakeRect(x,y,145,12)] autorelease];
    meter.levelIndicatorStyle=NSLevelIndicatorStyleContinuousCapacity;meter.minValue=0;meter.maxValue=1;
    meter.warningValue=.8;meter.criticalValue=.96;[self addSubview:meter];return meter;
}
- (instancetype)initWithBridge:(mygrain::Bridge*)owner {
    if((self=[super initWithFrame:NSMakeRect(0,0,780,756)])){
        bridge=owner;self.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
        NSString* logoPath=[[NSBundle bundleForClass:[self class]] pathForResource:@"mygrain-logo" ofType:@"png"];
        if(logoPath){NSImageView* image=[[[NSImageView alloc] initWithFrame:NSMakeRect(24,20,100,100)] autorelease];image.image=[[[NSImage alloc] initWithContentsOfFile:logoPath] autorelease];[self addSubview:image];}
        [self label:@"MYGRAIN" x:145 y:28 width:430 size:38];
        [self label:mygrain::isFx?@"FX / DAW + CHROME + DAW":@"BRIDGE / CHROME + DAW" x:148 y:81 width:430 size:13];
        [self label:@"YOUR CHROME CONNECTION" x:30 y:110 width:700 size:12];
        [self label:@"Your connection opens automatically. Keep creating." x:30 y:129 width:720 size:16];
        openButton=[self button:@"Open MYGRAIN in Chrome" tag:101 x:26 y:152 width:360 color:[NSColor systemBlueColor]];
        [self button:@"Copy code / manual connection" tag:102 x:396 y:152 width:358 color:[NSColor systemGrayColor]];
        [self label:mygrain::isFx?@"EFFECT CONTROL":@"TRANSPORT" x:30 y:216 width:700 size:12];
        armButton=[self button:@"Arm · follow DAW" tag:106 x:26 y:244 width:235 color:[NSColor systemGreenColor]];
        stopButton=[self button:@"Stop · disarm" tag:104 x:272 y:244 width:235 color:[NSColor systemRedColor]];
        playButton=[self button:@"Play · audition" tag:103 x:518 y:244 width:236 color:[NSColor systemOrangeColor]];
        [self label:@"NEW PATCH / REPLACES CURRENT · UNDO IN CHROME" x:30 y:323 width:720 size:10];
        sparseButton=[self button:@"Sparse Random" tag:201 x:26 y:344 width:174 color:[NSColor systemPurpleColor]];
        megaButton=[self button:@"Mega Random" tag:202 x:211 y:344 width:174 color:[NSColor systemPinkColor]];
        renderButton=[self button:@"Refresh render" tag:203 x:396 y:344 width:174 color:[NSColor systemBlueColor]];
        storeButton=[self button:@"Store in project" tag:204 x:581 y:344 width:174 color:[NSColor systemBlueColor]];
        remoteLabel=[self label:@"Connect Chrome for patch controls." x:30 y:403 width:720 size:12];remoteLabel.frame=NSMakeRect(30,403,720,34);
        remoteCount=[self label:@"" x:30 y:438 width:720 size:10];
        remoteProgress=[[[NSProgressIndicator alloc] initWithFrame:NSMakeRect(30,456,720,3)] autorelease];remoteProgress.indeterminate=NO;remoteProgress.minValue=0;[self addSubview:remoteProgress];
        [self label:@"LAYERS / LIT = ON · DARK = MUTED" x:30 y:478 width:720 size:10];
        for(unsigned i=0;i<mygrain::remoteLayerCount;i++){layerButtons[i]=[self button:[NSString stringWithUTF8String:mygrain::remoteLayerNames[i]] tag:300+i x:26+(i%5)*147 y:500+(i/5)*30 width:140 color:[NSColor systemTealColor]];layerButtons[i].frame=NSMakeRect(26+(i%5)*147,500+(i/5)*30,140,26);}
        statusLabel=[self label:@"Make the connection." x:30 y:664 width:565 size:17];
        detailLabel=[self label:@"" x:30 y:692 width:565 size:11];
        leftMeter=[self meterX:607 y:405];rightMeter=[self meterX:607 y:423];
        if(mygrain::isFx){inputLeft=[self meterX:607 y:38];inputRight=[self meterX:607 y:56];[self label:@"STEREO INPUT" x:608 y:77 width:145 size:10];}
        [self label:mygrain::isFx?@"macOS UNIVERSAL VST3 FX · 0.3.0 PREVIEW · 1,000 ms aligned delay":@"macOS UNIVERSAL VST3 · 0.7.0 PREVIEW · Live / Rendered" x:30 y:732 width:590 size:10];
        NSButton* disconnect=[self button:@"Disconnect" tag:105 x:626 y:726 width:128 color:[NSColor systemGrayColor]];disconnect.frame=NSMakeRect(626,726,128,26);
        timer=[[NSTimer alloc] initWithFireDate:[NSDate dateWithTimeIntervalSinceNow:.1] interval:.1 target:self selector:@selector(tick:) userInfo:nil repeats:YES];
        [[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];[self tick:nil];
    }return self;
}
- (void)copyCode {
    if(!bridge->server||!bridge->server->port())return;
    NSPasteboard* board=[NSPasteboard generalPasteboard];[board clearContents];
    [board setString:[NSString stringWithUTF8String:bridge->server->connection().c_str()] forType:NSPasteboardTypeString];
}
- (void)launch {
    if(!bridge->server||!bridge->server->port()||bridge->engine.connected.load()||[NSDate timeIntervalSinceReferenceDate]<cooldown)return;
    NSURL* chrome=[[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:@"com.google.Chrome"];
    if(!chrome){[self copyCode];NSAlert* alert=[[[NSAlert alloc] init] autorelease];alert.messageText=@"Google Chrome is required";
        alert.informativeText=@"Install Chrome, then use Open MYGRAIN in Chrome. A manual connection code has been copied.";[alert runModal];return;}
    NSURL* url=[NSURL URLWithString:[NSString stringWithUTF8String:bridge->server->url().c_str()]];
    // Do not capture the editor in an asynchronous callback: it may already close.
    NSWorkspaceOpenConfiguration* configuration=[NSWorkspaceOpenConfiguration configuration];
    [[NSWorkspace sharedWorkspace] openURLs:@[url] withApplicationAtURL:chrome configuration:configuration completionHandler:nil];
    cooldown=[NSDate timeIntervalSinceReferenceDate]+8;
}
- (void)action:(NSButton*)sender {
    auto& e=bridge->engine;
    if(sender.tag>=300&&sender.tag<300+mygrain::remoteLayerCount){auto state=e.remote.get();e.remote.request(3,sender.tag-300,!(state.enabled&(1u<<(sender.tag-300))));[self tick:nil];return;}
    try {switch(sender.tag){
        case 201:e.remote.request(1);break;case 202:e.remote.request(2);break;case 203:e.remote.request(4);break;case 204:e.remote.request(5);break;
        case 101:if(!e.connected.load()){bridge->enable();pendingOpen=true;}break;
        case 102:bridge->enable();pendingCopy=true;break;
        case 106:e.requestArm();break;
        case 103:if((e.connected.load()&&e.browserReady.load())||e.project.rendered.load())e.requestStart();break;
        case 104:e.requestStop();break;
        case 105:e.browserReady.store(false);e.connected.store(false);e.requestPause();break;
    }}catch(...){detailLabel.stringValue=@"The local bridge could not start. Try reopening the plugin.";}
    [self tick:nil];
}
- (void)tick:(NSTimer*)sender {
    (void)sender;auto& e=bridge->engine;
    if(bridge->server&&bridge->server->port()){
        if(pendingOpen){pendingOpen=false;[self launch];}if(pendingCopy){pendingCopy=false;[self copyCode];}
    }
    const bool connected=e.connected.load(),ready=e.browserReady.load(),armed=e.armed.load();
    NSString *title=@"Make the connection.",*detail=@"Open Chrome. Sign in normally, allow local-network access, and press Start MYGRAIN if asked.";
    if(bridge->server&&!bridge->server->port())title=@"Starting the local bridge…";
    else if(!mygrain::isFx&&e.project.rendered.load()&&e.preparedMode.load()){title=armed?@"Saved Rendered loop · DAW ready":@"Saved Rendered loop · stopped";detail=@"Audio is stored in the project. Open Chrome to recall the editable patch.";}
    else if(bridge->server&&!connected)title=armed?@"Armed · waiting for Chrome":@"Waiting for Chrome";
    else if(connected&&!ready)title=@"Chrome connected · enabling audio";
    else if(connected){
        if(mygrain::isFx){
            title=e.offline.load()?@"Offline · aligned dry fallback":e.fx->bypass.load()?@"Bypassed · aligned dry":e.running.load()?@"DAW input / Chrome FX return":armed?@"Armed · buffering FX return":@"Dry · ready when you are";
            detail=@"1,000 ms fixed delay, reported to Bitwig. Choose routing and dry/wet in the DAW INPUT card. Print wet audio in real time.";
        }else{
            title=e.running.load()?(e.preparedMode.load()?@"Rendered loop playing":@"Live performance"):armed?@"Armed · ready for the DAW":@"Connected · ready when you are";
            detail=e.preparedMode.load()?@"Following the DAW timeline. Refresh your rendered snapshot in Chrome after editing.":@"Arm follows DAW Play. Orange Play auditions while stopped; Live starts on a future bar.";
        }
    }
    if(![statusLabel.stringValue isEqualToString:title])statusLabel.stringValue=title;
    if(![detailLabel.stringValue isEqualToString:detail])detailLabel.stringValue=detail;
    const bool canOpen=!connected&&[NSDate timeIntervalSinceReferenceDate]>=cooldown;
    if(openButton.enabled!=canOpen)openButton.enabled=canOpen;
    NSString* openTitle=connected?@"Chrome connected":@"Open MYGRAIN in Chrome";
    if(![openButton.title isEqualToString:openTitle])openButton.title=openTitle;
    NSString* armTitle=armed?@"Armed · follow DAW":@"Arm · follow DAW";
    if(![armButton.title isEqualToString:armTitle])armButton.title=armTitle;
    const bool canPlay=(connected&&ready)||(!mygrain::isFx&&e.project.rendered.load()),canStop=connected||armed;
    if(playButton.enabled!=canPlay)playButton.enabled=canPlay;
    if(stopButton.enabled!=canStop)stopButton.enabled=canStop;
    const auto remote=e.remote.get();const bool patchReady=connected&&ready&&remote.supported&&remote.ready&&!remote.busy;
    auto enabled=[](NSButton* button,bool value){if(button.enabled!=value)button.enabled=value;};
    enabled(sparseButton,patchReady);enabled(megaButton,patchReady);enabled(renderButton,patchReady&&!mygrain::isFx&&e.preparedMode.load()&&!e.playing.load());enabled(storeButton,patchReady&&!e.playing.load());
    for(unsigned i=0;i<mygrain::remoteLayerCount;i++){enabled(layerButtons[i],patchReady&&(remote.available&(1u<<i)));const auto value=remote.enabled&(1u<<i)?NSControlStateValueOn:NSControlStateValueOff;if(layerButtons[i].state!=value)layerButtons[i].state=value;}
    NSString* remoteText=[NSString stringWithUTF8String:remote.text.c_str()];if(remoteText&&![remoteLabel.stringValue isEqualToString:remoteText])remoteLabel.stringValue=remoteText;
    NSString* counts=remote.total?[NSString stringWithFormat:@"%u / %u layer jobs finished · %u warnings",remote.done,remote.total,remote.warnings]:remote.busy?@"Working…":@"Stop the DAW to refresh or store. Later edits need Store, then DAW Save.";
    if(![remoteCount.stringValue isEqualToString:counts])remoteCount.stringValue=counts;
    remoteProgress.hidden=remote.total==0;if(remoteProgress.maxValue!=std::max(1u,remote.total))remoteProgress.maxValue=std::max(1u,remote.total);if(remoteProgress.doubleValue!=remote.done)remoteProgress.doubleValue=remote.done;
    auto update=[](NSLevelIndicator* meter,float peak){if(!meter)return;const double level=std::clamp((20.*std::log10(std::max(.00001f,peak))+60.)/60.,0.,1.);if(std::abs(meter.doubleValue-level)>.005)meter.doubleValue=level;};
    update(leftMeter,bridge->peakLeft.load());update(rightMeter,bridge->peakRight.load());
    if(mygrain::isFx){update(inputLeft,e.fx->inputLeft.load());update(inputRight,e.fx->inputRight.load());}
}
- (void)dealloc { if(timer){[timer invalidate];[timer release];timer=nil;}[super dealloc]; }
@end
namespace mygrain {
BridgeView::BridgeView(Bridge& b):owner(b){owner.addRef();rect=ViewRect(0,0,780,756);}
BridgeView::~BridgeView(){removed();owner.release();}
tresult PLUGIN_API BridgeView::attached(void* parent,FIDString type){
    if(!parent||native||isPlatformTypeSupported(type)!=kResultTrue)return kResultFalse;
    auto* view=[[MGNativeView alloc] initWithBridge:&owner];native=view;
    [(NSView*)parent addSubview:view];systemWindow=parent;return kResultOk;
}
tresult PLUGIN_API BridgeView::removed(){
    if(native){auto* view=(MGNativeView*)native;[view->timer invalidate];[view->timer release];view->timer=nil;[view removeFromSuperview];[view release];native=nullptr;}
    systemWindow=nullptr;return kResultOk;
}
}
#undef MGNativeView
#undef MGArtButton
