// AppKit lives exclusively on the host UI thread, never on the audio callback.
// Distinct Objective-C class names let both bundles coexist in Bitwig's process.
#ifdef MYGRAIN_FX
#define MGNativeView MYGRAINFXNativeView
#else
#define MGNativeView MYGRAINInstrumentNativeView
#endif
@interface MGNativeView : NSView {
@public
    mygrain::Bridge* bridge;
    NSTimer* timer;
    NSButton *openButton,*armButton,*playButton,*stopButton;
    NSTextField *statusLabel,*detailLabel;
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
    NSButton* button=[NSButton buttonWithTitle:text target:self action:@selector(action:)];
    button.frame=NSMakeRect(x,y,width,48);button.tag=tag;button.bezelStyle=NSBezelStyleRounded;
    button.font=[NSFont systemFontOfSize:15 weight:NSFontWeightSemibold];button.bezelColor=color;
    [self addSubview:button];return button;
}
- (NSLevelIndicator*)meterX:(double)x y:(double)y {
    NSLevelIndicator* meter=[[[NSLevelIndicator alloc] initWithFrame:NSMakeRect(x,y,145,12)] autorelease];
    meter.levelIndicatorStyle=NSLevelIndicatorStyleContinuousCapacity;meter.minValue=0;meter.maxValue=1;
    meter.warningValue=.8;meter.criticalValue=.96;[self addSubview:meter];return meter;
}
- (instancetype)initWithBridge:(mygrain::Bridge*)owner {
    if((self=[super initWithFrame:NSMakeRect(0,0,780,552)])){
        bridge=owner;self.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
        NSString* logoPath=[[NSBundle bundleForClass:[self class]] pathForResource:@"mygrain-logo" ofType:@"png"];
        if(logoPath){NSImageView* image=[[[NSImageView alloc] initWithFrame:NSMakeRect(24,20,100,100)] autorelease];image.image=[[[NSImage alloc] initWithContentsOfFile:logoPath] autorelease];[self addSubview:image];}
        [self label:@"MYGRAIN" x:145 y:28 width:430 size:38];
        [self label:mygrain::isFx?@"FX / DAW + CHROME + DAW":@"BRIDGE / CHROME + DAW" x:148 y:81 width:430 size:13];
        [self label:@"YOUR CHROME CONNECTION" x:30 y:143 width:700 size:12];
        [self label:@"Your connection opens automatically. Keep creating." x:30 y:168 width:720 size:16];
        openButton=[self button:@"Open MYGRAIN in Chrome" tag:101 x:26 y:205 width:360 color:[NSColor systemBlueColor]];
        [self button:@"Copy code / manual connection" tag:102 x:396 y:205 width:358 color:[NSColor systemGrayColor]];
        [self label:mygrain::isFx?@"EFFECT CONTROL":@"TRANSPORT" x:30 y:280 width:700 size:12];
        armButton=[self button:@"Arm · follow DAW" tag:106 x:26 y:312 width:235 color:[NSColor systemGreenColor]];
        stopButton=[self button:@"Stop · disarm" tag:104 x:272 y:312 width:235 color:[NSColor systemRedColor]];
        playButton=[self button:@"Play · audition" tag:103 x:518 y:312 width:236 color:[NSColor systemOrangeColor]];
        statusLabel=[self label:@"Make the connection." x:30 y:400 width:565 size:20];
        detailLabel=[self label:@"" x:30 y:445 width:720 size:13];
        leftMeter=[self meterX:607 y:405];rightMeter=[self meterX:607 y:423];
        if(mygrain::isFx){inputLeft=[self meterX:607 y:38];inputRight=[self meterX:607 y:56];[self label:@"STEREO INPUT" x:608 y:77 width:145 size:10];}
        [self label:mygrain::isFx?@"macOS UNIVERSAL VST3 FX · 0.1.0 PREVIEW · 1,000 ms aligned delay":@"macOS UNIVERSAL VST3 · 0.5.0 PREVIEW · Live / Rendered" x:30 y:510 width:590 size:10];
        [self button:@"Disconnect" tag:105 x:626 y:490 width:128 color:[NSColor systemGrayColor]];
        timer=[[NSTimer timerWithTimeInterval:.1 target:self selector:@selector(tick:) userInfo:nil repeats:YES] retain];
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
    try {switch(sender.tag){
        case 101:if(!e.connected.load()){bridge->enable();pendingOpen=true;}break;
        case 102:bridge->enable();pendingCopy=true;break;
        case 106:e.requestArm();break;
        case 103:if(e.connected.load()&&e.browserReady.load())e.requestStart();break;
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
    openButton.enabled=!connected&&[NSDate timeIntervalSinceReferenceDate]>=cooldown;
    NSString* openTitle=connected?@"Chrome connected":@"Open MYGRAIN in Chrome";
    if(![openButton.title isEqualToString:openTitle])openButton.title=openTitle;
    NSString* armTitle=armed?@"Armed · follow DAW":@"Arm · follow DAW";
    if(![armButton.title isEqualToString:armTitle])armButton.title=armTitle;
    playButton.enabled=connected&&ready;stopButton.enabled=connected||armed;
    auto update=[](NSLevelIndicator* meter,float peak){if(!meter)return;const double level=std::clamp((20.*std::log10(std::max(.00001f,peak))+60.)/60.,0.,1.);if(std::abs(meter.doubleValue-level)>.005)meter.doubleValue=level;};
    update(leftMeter,bridge->peakLeft.load());update(rightMeter,bridge->peakRight.load());
    if(mygrain::isFx){update(inputLeft,e.fx->inputLeft.load());update(inputRight,e.fx->inputRight.load());}
}
- (void)dealloc { if(timer){[timer invalidate];[timer release];timer=nil;}[super dealloc]; }
@end
namespace mygrain {
BridgeView::BridgeView(Bridge& b):owner(b){owner.addRef();rect=ViewRect(0,0,780,552);}
BridgeView::~BridgeView(){removed();owner.release();}
tresult PLUGIN_API BridgeView::attached(void* parent,FIDString type){
    if(!parent||native||isPlatformTypeSupported(type)!=kResultTrue)return kResultFalse;
    auto* view=[[MGNativeView alloc] initWithBridge:&owner];native=view;
    [(NSView*)parent addSubview:view];systemWindow=parent;return kResultOk;
}
tresult PLUGIN_API BridgeView::removed(){
    if(native){auto* view=(MGNativeView*)native;[view->timer invalidate];[view removeFromSuperview];[view release];native=nullptr;}
    systemWindow=nullptr;return kResultOk;
}
}
#undef MGNativeView
