#pragma once
#include "../src/remote.h"

namespace mygrain::cef {
constexpr int toolbarHeight=104;
struct ToolbarItem {int id,width;const char* title;};
constexpr ToolbarItem toolbarItems[]={{106,174,"Arm - follow DAW"},{104,68,"Stop"},{102,106,"Store now"},{220,142,"Auto-save: On"},{101,174,"Store + reload app"},{223,64,"Every (s)"},{221,62,"60"},{222,66,"Apply"}};
inline double toolbarScale(double width){return std::min(1.,std::max(.7,(width-24)/1012));}
inline std::string toolbarActivity(const RemoteState& remote,bool armed,bool playing){
    const std::string transport=!armed?"Output disarmed - click Arm, then Play in your DAW":playing?"Following DAW playback":"Armed - waiting for DAW Play";
    if(remote.companion.supported)return transport+" | "+(remote.busy||remote.text.rfind("Could not finish",0)==0?remote.text:remote.companion.text);
    return transport+" | "+remote.text;
}
inline std::string toolbarStats(const CompanionState& c){
    if(!c.supported)return "Auto-save defaults to On / 60 s after sign-in and Start MYGRAIN. Save your DAW project normally to write it to disk.";
    std::ostringstream o;
    if(c.last){std::time_t when=c.last;auto tm=std::localtime(&when);o<<"Last store "<<std::put_time(tm,"%H:%M:%S")<<" / "<<std::fixed<<std::setprecision(2)<<double(c.duration)/1000<<" s / sent "<<companionBytes(c.wire)<<" / patch "<<companionBytes(c.bytes);}
    else o<<"No completed store in this connection";
    o<<" | "<<c.count<<" stores / "<<c.skipped<<" unchanged | ";
    if(c.syncing)o<<"Storing now";
    else if(!c.autoStore)o<<"Auto-save paused";
    else o<<"Next check "<<c.next<<" s";
    o<<" | Save your DAW project normally.";
    return o.str();
}
}
