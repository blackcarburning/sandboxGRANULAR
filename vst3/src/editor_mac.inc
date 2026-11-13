// AppKit lives exclusively on the host UI thread, never on the audio callback.
// Distinct Objective-C class names let both bundles coexist in Bitwig's process.
#ifdef MYGRAIN_FX
#define MGNativeView MYGRAINFXNativeView
#define MGArtButton MYGRAINFXArtButton
#define MGPotRow MYGRAINFXPotRow
#else
#define MGNativeView MYGRAINInstrumentNativeView
#define MGArtButton MYGRAINInstrumentArtButton
#define MGPotRow MYGRAINInstrumentPotRow
#endif
@interface MGArtButton : NSButton
@property(nonatomic,retain) NSColor* effectColor;
@end
@implementation MGArtButton
- (void)drawRect:(NSRect)dirty {
    (void)dirty;CGFloat red=.14,green=.21,blue=.30;
    if(self.tag==106){red=.08;green=.34;blue=.23;}else if(self.tag==104){red=.43;green=.12;blue=.19;}else if(self.tag==103){red=.48;green=.28;blue=.09;}
    else if(self.tag==201){red=.28;green=.19;blue=.45;}else if(self.tag==202){red=.45;green=.15;blue=.35;}
    else if(self.tag>=300){if(self.state==NSControlStateValueOn){red=.08;green=.34;blue=.30;}else{red=.08;green=.11;blue=.17;}}
    if(self.effectColor){CGFloat r=0,g=0,b=0;[[self.effectColor colorUsingColorSpace:[NSColorSpace sRGBColorSpace]] getRed:&r green:&g blue:&b alpha:nullptr];const double amount=self.state==NSControlStateValueOn?.25:.12;red=.06+r*amount;green=.07+g*amount;blue=.09+b*amount;}
    if((self.tag==210||self.tag==220)&&self.state==NSControlStateValueOn){red=.08;green=.34;blue=.30;}
    if(!self.enabled){red=.10;green=.13;blue=.18;}if(self.cell.highlighted){red*=.7;green*=.7;blue*=.7;}
    NSRect rect=NSInsetRect(self.bounds,1,1);NSBezierPath* path=[NSBezierPath bezierPathWithRoundedRect:rect xRadius:8 yRadius:8];
    NSColor* top=[NSColor colorWithSRGBRed:red+.04 green:green+.04 blue:blue+.04 alpha:1];NSColor* bottom=[NSColor colorWithSRGBRed:red green:green blue:blue alpha:1];
    NSGradient* gradient=[[[NSGradient alloc] initWithStartingColor:top endingColor:bottom] autorelease];[gradient drawInBezierPath:path angle:90];
    [[NSColor colorWithSRGBRed:red+.19 green:green+.19 blue:blue+.19 alpha:1] setStroke];path.lineWidth=1;[path stroke];
    NSMutableParagraphStyle* style=[[[NSMutableParagraphStyle alloc] init] autorelease];style.alignment=NSTextAlignmentCenter;style.lineBreakMode=NSLineBreakByTruncatingTail;
    NSDictionary* attributes=@{NSFontAttributeName:[NSFont systemFontOfSize:self.tag>=300?11:13 weight:NSFontWeightSemibold],NSForegroundColorAttributeName:self.enabled?[NSColor colorWithSRGBRed:.91 green:.95 blue:1 alpha:1]:[NSColor colorWithSRGBRed:.44 green:.51 blue:.62 alpha:1],NSParagraphStyleAttributeName:style};
    if(self.image){[self.image drawInRect:NSMakeRect(5,(self.bounds.size.height-24)/2,24,24) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:self.enabled?1:.45 respectFlipped:YES hints:nil];style.alignment=NSTextAlignmentLeft;}
    [self.title drawInRect:NSMakeRect(self.image?36:5,(self.bounds.size.height-17)/2,self.bounds.size.width-(self.image?40:10),19) withAttributes:attributes];
    if(self.window.firstResponder==self){[[NSColor keyboardFocusIndicatorColor] setStroke];NSBezierPath* focus=[NSBezierPath bezierPathWithRoundedRect:NSInsetRect(rect,3,3) xRadius:6 yRadius:6];[focus stroke];}
}
- (void)dealloc {self.effectColor=nil;[super dealloc];}
@end
@interface MGPotRow : MGArtButton
@end
@interface MGNativeView : NSView {
@public
    mygrain::Bridge* bridge;
    NSTimer* timer;
    NSButton *openButton,*armButton,*playButton,*stopButton;
    NSTextField *statusLabel,*detailLabel,*remoteLabel,*remoteCount;
    NSProgressIndicator* remoteProgress;
    NSButton* layerButtons[25];
    NSButton *potRows[9],*potPower[9],*potUp[9],*potDown[9],*potToggle,*stirButton,*bigStirButton,*autoButton,*intervalButton;
    NSTextField *intervalField,*saveStats;uint32_t previousInterval;
    NSButton *sparseButton,*megaButton,*renderButton,*storeButton;
    NSLevelIndicator *leftMeter,*rightMeter,*inputLeft,*inputRight;
    bool pendingOpen,pendingCopy;
    double cooldown;
}
- (void)tick:(NSTimer*)sender;
- (void)action:(NSButton*)sender;
- (void)movePotRow:(NSInteger)row to:(NSInteger)position;
@end
@implementation MGPotRow
- (void)mouseDown:(NSEvent*)event {
    if(!self.enabled)return;NSPoint start=event.locationInWindow;BOOL dragged=NO;NSEvent* next=nil;
    while((next=[self.window nextEventMatchingMask:NSEventMaskLeftMouseDragged|NSEventMaskLeftMouseUp untilDate:[NSDate distantFuture] inMode:NSEventTrackingRunLoopMode dequeue:YES])){
        if(std::hypot(next.locationInWindow.x-start.x,next.locationInWindow.y-start.y)>5)dragged=YES;
        if(next.type==NSEventTypeLeftMouseUp){if(dragged){NSPoint p=[self.superview convertPoint:next.locationInWindow fromView:nil];[(MGNativeView*)self.target movePotRow:self.tag-400 to:std::clamp(int((p.y-230)/35),0,8)];}else[self performClick:nil];break;}
    }
}
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
    NSButton* button=[(tag>=400&&tag<409?[MGPotRow class]:[MGArtButton class]) buttonWithTitle:text target:self action:@selector(action:)];
    button.frame=NSMakeRect(x,y,width,48);button.tag=tag;button.bezelStyle=NSBezelStyleRounded;
    button.font=[NSFont systemFontOfSize:15 weight:NSFontWeightSemibold];button.bezelColor=color;
    button.controlSize=NSControlSizeLarge;if(tag==106||tag==103||tag==104)button.contentTintColor=color;
    [self addSubview:button];return button;
}
- (void)icon:(NSString*)name button:(NSButton*)button {
    NSString* path=[[NSBundle bundleForClass:[self class]] pathForResource:[@"pot-" stringByAppendingString:name] ofType:@"png"];
    if(path)button.image=[[[NSImage alloc] initWithContentsOfFile:path] autorelease];
}
- (NSLevelIndicator*)meterX:(double)x y:(double)y {
    NSLevelIndicator* meter=[[[NSLevelIndicator alloc] initWithFrame:NSMakeRect(x,y,145,12)] autorelease];
    meter.levelIndicatorStyle=NSLevelIndicatorStyleContinuousCapacity;meter.minValue=0;meter.maxValue=1;
    meter.warningValue=.8;meter.criticalValue=.96;[self addSubview:meter];return meter;
}
- (instancetype)initWithBridge:(mygrain::Bridge*)owner {
    if((self=[super initWithFrame:NSMakeRect(0,0,1240,756)])){
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
        [self label:mygrain::isFx?@"macOS UNIVERSAL VST3 FX · 0.4.0 PREVIEW · 1,000 ms aligned delay":@"macOS UNIVERSAL VST3 · 0.8.0 PREVIEW · Live / Rendered" x:30 y:732 width:590 size:10];
        NSButton* disconnect=[self button:@"Disconnect" tag:105 x:626 y:726 width:128 color:[NSColor systemGrayColor]];disconnect.frame=NSMakeRect(626,726,128,26);
        [self label:@"THE COOKING POT" x:802 y:115 width:390 size:23];
        [self label:@"SERIAL EFFECTS MATRIX · SAME PATCH / SAME SWITCHES" x:802 y:147 width:400 size:9];
        potToggle=[self button:@"Cooking pot Off" tag:210 x:800 y:162 width:146 color:[NSColor systemTealColor]];potToggle.frame=NSMakeRect(800,162,146,34);[self icon:@"pot" button:potToggle];
        stirButton=[self button:@"Stir" tag:211 x:952 y:162 width:104 color:[NSColor systemTealColor]];stirButton.frame=NSMakeRect(952,162,104,34);[self icon:@"spoon" button:stirButton];
        bigStirButton=[self button:@"BIG STIR" tag:212 x:1062 y:162 width:134 color:[NSColor systemTealColor]];bigStirButton.frame=NSMakeRect(1062,162,134,34);[self icon:@"ladle" button:bigStirButton];
        [self label:@"DRAG A ROW · CLICK ITS NAME TO OPEN THE EFFECT" x:802 y:205 width:400 size:9];
        for(unsigned row=0;row<9;row++){
            potRows[row]=[self button:@"Effect" tag:400+row x:800 y:230+row*35 width:214 color:[NSColor systemTealColor]];potRows[row].frame=NSMakeRect(800,230+row*35,214,31);
            potPower[row]=[self button:@"Off" tag:500+row x:1020 y:230+row*35 width:62 color:[NSColor systemTealColor]];potPower[row].frame=NSMakeRect(1020,230+row*35,62,31);
            potUp[row]=[self button:@"↑" tag:600+row x:1088 y:230+row*35 width:48 color:[NSColor systemGrayColor]];potUp[row].frame=NSMakeRect(1088,230+row*35,48,31);
            potDown[row]=[self button:@"↓" tag:700+row x:1142 y:230+row*35 width:48 color:[NSColor systemGrayColor]];potDown[row].frame=NSMakeRect(1142,230+row*35,48,31);
        }
        [self label:@"Reorder by dragging or with arrows. Off effects bypass." x:802 y:552 width:400 size:10];
        [self label:@"Stir: two On. BIG STIR: new recipes; Bubble stays Off." x:802 y:572 width:400 size:10];
        autoButton=[self button:@"Auto-store On" tag:220 x:800 y:610 width:145 color:[NSColor systemTealColor]];autoButton.frame=NSMakeRect(800,610,145,30);
        intervalField=[[[NSTextField alloc] initWithFrame:NSMakeRect(956,610,65,30)] autorelease];intervalField.stringValue=@"60";intervalField.font=[NSFont systemFontOfSize:15];[self addSubview:intervalField];
        intervalButton=[self button:@"Apply" tag:222 x:1028 y:610 width:76 color:[NSColor systemBlueColor]];intervalButton.frame=NSMakeRect(1028,610,76,30);
        [self label:@"seconds" x:1118 y:613 width:80 size:10];
        saveStats=[self label:@"Connect Chrome for automatic patch storage." x:802 y:647 width:395 size:11];saveStats.frame=NSMakeRect(802,647,395,78);saveStats.maximumNumberOfLines=4;
        [self label:@"SAVE YOUR DAW PROJECT NORMALLY" x:802 y:729 width:400 size:9];
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
- (void)movePotRow:(NSInteger)row to:(NSInteger)position {auto state=bridge->engine.remote.get();if(row>=0&&row<9&&position>=0&&position<9)bridge->engine.remote.request(9,state.companion.order[row],position);[self tick:nil];}
- (void)action:(NSButton*)sender {
    auto& e=bridge->engine;
    if(sender.tag>=400&&sender.tag<409){auto state=e.remote.get();e.remote.request(10,state.companion.order[sender.tag-400]);[self tick:nil];return;}
    if(sender.tag>=500&&sender.tag<509){auto state=e.remote.get();auto key=state.companion.order[sender.tag-500];e.remote.request(7,key,!(state.companion.mask&(1u<<key)));[self tick:nil];return;}
    if((sender.tag>=600&&sender.tag<609)||(sender.tag>=700&&sender.tag<709)){[self movePotRow:sender.tag%100 to:sender.tag%100+(sender.tag>=700?1:-1)];return;}
    if(sender.tag>=300&&sender.tag<300+mygrain::remoteLayerCount){auto state=e.remote.get();e.remote.request(3,sender.tag-300,!(state.enabled&(1u<<(sender.tag-300))));[self tick:nil];return;}
    try {switch(sender.tag){
        case 210:{auto state=e.remote.get();e.remote.request(6,0,!state.companion.pot);break;}
        case 211:e.remote.request(8,0);break;case 212:e.remote.request(8,1);break;
        case 220:{auto state=e.remote.get();e.remote.request(11,0,!state.companion.autoStore);break;}
        case 222:e.remote.request(12,0,std::clamp(int(intervalField.intValue),15,3600));break;
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
    auto enabled=[](NSControl* button,bool value){if(button.enabled!=value)button.enabled=value;};
    enabled(sparseButton,patchReady);enabled(megaButton,patchReady);enabled(renderButton,patchReady&&!mygrain::isFx&&e.preparedMode.load()&&!e.playing.load());enabled(storeButton,patchReady);
    for(unsigned i=0;i<mygrain::remoteLayerCount;i++){enabled(layerButtons[i],patchReady&&(remote.available&(1u<<i)));const auto value=remote.enabled&(1u<<i)?NSControlStateValueOn:NSControlStateValueOff;if(layerButtons[i].state!=value)layerButtons[i].state=value;}
    const auto& pot=remote.companion;const bool potReady=patchReady&&pot.supported;
    for(NSControl* c in @[potToggle,stirButton,bigStirButton,autoButton,intervalField,intervalButton])enabled(c,potReady);
    NSString* potTitle=pot.pot?@"Cooking pot On":@"Cooking pot Off";if(![potToggle.title isEqualToString:potTitle])potToggle.title=potTitle;if(potToggle.state!=(pot.pot?NSControlStateValueOn:NSControlStateValueOff))potToggle.state=pot.pot?NSControlStateValueOn:NSControlStateValueOff;
    NSString* autoTitle=pot.autoStore?@"Auto-store On":@"Auto-store Off";if(![autoButton.title isEqualToString:autoTitle])autoButton.title=autoTitle;if(autoButton.state!=(pot.autoStore?NSControlStateValueOn:NSControlStateValueOff))autoButton.state=pot.autoStore?NSControlStateValueOn:NSControlStateValueOff;
    if(previousInterval!=pot.interval){intervalField.stringValue=[NSString stringWithFormat:@"%u",pot.interval];previousInterval=pot.interval;}
    const char* images[]={"mutilator","bassFace","turntable","resonator","wireWorld","sonicCrystal","bubbleChamber","wasp","playground"};
    for(unsigned row=0;row<9;row++){
        const auto key=pot.order[row];NSString* title=[NSString stringWithUTF8String:mygrain::potNames[key]];if(![potRows[row].title isEqualToString:title]){potRows[row].title=title;[self icon:[NSString stringWithUTF8String:images[key]] button:potRows[row]];unsigned c=mygrain::potColors[key];NSColor* color=[NSColor colorWithSRGBRed:((c>>16)&255)/255. green:((c>>8)&255)/255. blue:(c&255)/255. alpha:1];((MGArtButton*)potRows[row]).effectColor=color;((MGArtButton*)potPower[row]).effectColor=color;}
        const bool on=pot.mask&(1u<<key);NSString* power=on?@"On":@"Off";if(![potPower[row].title isEqualToString:power])potPower[row].title=power;
        const auto lit=on?NSControlStateValueOn:NSControlStateValueOff;if(potRows[row].state!=lit)potRows[row].state=lit;if(potPower[row].state!=lit)potPower[row].state=lit;
        enabled(potRows[row],potReady);enabled(potPower[row],potReady);enabled(potUp[row],potReady&&row>0);enabled(potDown[row],potReady&&row<8);
    }
    NSString* save=[NSString stringWithUTF8String:mygrain::companionStats(pot).c_str()];if(![saveStats.stringValue isEqualToString:save])saveStats.stringValue=save;
    NSString* remoteText=[NSString stringWithUTF8String:remote.text.c_str()];if(remoteText&&![remoteLabel.stringValue isEqualToString:remoteText])remoteLabel.stringValue=remoteText;
    NSString* counts=remote.total?[NSString stringWithFormat:@"%u / %u layer jobs finished · %u warnings",remote.done,remote.total,remote.warnings]:remote.busy?@"Working…":@"Auto-store runs at your interval. Save the DAW project normally. Stop to render.";
    if(![remoteCount.stringValue isEqualToString:counts])remoteCount.stringValue=counts;
    remoteProgress.hidden=remote.total==0;if(remoteProgress.maxValue!=std::max(1u,remote.total))remoteProgress.maxValue=std::max(1u,remote.total);if(remoteProgress.doubleValue!=remote.done)remoteProgress.doubleValue=remote.done;
    auto update=[](NSLevelIndicator* meter,float peak){if(!meter)return;const double level=std::clamp((20.*std::log10(std::max(.00001f,peak))+60.)/60.,0.,1.);if(std::abs(meter.doubleValue-level)>.005)meter.doubleValue=level;};
    update(leftMeter,bridge->peakLeft.load());update(rightMeter,bridge->peakRight.load());
    if(mygrain::isFx){update(inputLeft,e.fx->inputLeft.load());update(inputRight,e.fx->inputRight.load());}
}
- (void)dealloc { if(timer){[timer invalidate];[timer release];timer=nil;}[super dealloc]; }
@end
namespace mygrain {
BridgeView::BridgeView(Bridge& b):owner(b){owner.addRef();rect=ViewRect(0,0,1240,756);}
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
#undef MGPotRow
