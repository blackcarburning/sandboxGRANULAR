#pragma once
#include <mutex>
#include <string>
#include <cstdint>
#include <algorithm>
#include <array>
#include <sstream>
#include <iomanip>
#include <ctime>
namespace mygrain {
constexpr unsigned remoteLayerCount=25;
constexpr const char* remoteLayerNames[]={"Reverb","Delay","Osc","Granular","Piano","Strings","N Noise","Sample","Loop","Loop A","Loop B","Loop C","Loop V","Loop D","Loop W","Loop P","Loop O","Loop L","Loop X","Loop Q","Loop M","Loop M+","Loop K","Dropbox","Drums"};
constexpr const char* potNames[]={"Mutilator","Bass Face","Turntable","Olaf's Resonator","WireWorld","Sonic Crystal","Bubble Chamber","The Wasp","Filter Playground"};
constexpr unsigned potColors[]={0xc8ff62,0xddb9ff,0xe0c69a,0xe8a277,0xffba76,0x95fbd9,0xa6ccff,0xf9d96a,0x65e6d6};
struct CompanionState {bool supported=false,pot=false,autoStore=true,syncing=false;uint32_t mask=0,interval=60,next=60,last=0,duration=0,wire=0,bytes=0,count=0,skipped=0;uint64_t total=0;std::array<uint8_t,9> order{{0,1,2,3,4,5,6,7,8}};std::string text="Connect Chrome for automatic patch storage.";};
struct RemoteState {CompanionState companion;bool supported=false,ready=false,busy=false;uint32_t id=0,done=0,total=0,warnings=0,enabled=0,available=0,revision=0;std::string text="Connect Chrome for randomisation and layer controls.";};
inline std::string companionBytes(uint64_t n){std::ostringstream o;o<<std::fixed<<std::setprecision(n>=1048576?2:1);if(n>=1048576)o<<double(n)/1048576<<" MiB";else if(n>=1024)o<<double(n)/1024<<" KiB";else o<<n<<" B";return o.str();}
inline std::string companionStats(const CompanionState& c){
    std::ostringstream o;
    if(c.last){std::time_t when=c.last;auto tm=std::localtime(&when);o<<"Last store: "<<std::put_time(tm,"%H:%M:%S")<<" / "<<std::fixed<<std::setprecision(2)<<double(c.duration)/1000<<" s";}
    else o<<"Last store: none in this connection";
    o<<"\nTransferred: "<<companionBytes(c.wire)<<" / patch: "<<companionBytes(c.bytes);
    o<<"\n"<<c.count<<" stores / "<<c.skipped<<" unchanged / total "<<companionBytes(c.total);
    o<<"\n"<<(c.syncing?"Storing now - playback continues":!c.autoStore?"Automatic storage paused":"Next check: "+std::to_string(c.next)+" s");return o.str();
}
struct RemoteCommand {uint32_t id=0,action=0,index=0,value=0;};
class RemoteControl {
    std::mutex mutex;RemoteState state;RemoteCommand queued;uint32_t serial=0;bool sent=false;
public:
    RemoteState get(){std::lock_guard<std::mutex> lock(mutex);return state;}
    void disconnect(){std::lock_guard<std::mutex> lock(mutex);state.companion.supported=false;state.supported=false;state.ready=false;state.busy=false;state.available=0;state.text="Chrome disconnected. Reconnect for patch controls.";state.revision++;queued={};sent=false;}
    bool request(uint32_t action,uint32_t index=0,uint32_t value=0){
        std::lock_guard<std::mutex> lock(mutex);if(!state.supported||!state.ready||state.busy||queued.id||action<1||action>12||(action==3&&(index>=remoteLayerCount||!(state.available&(1u<<index))||value>1))||
           (action>=6&&!state.companion.supported)||(action==6&&(index||value>1))||(action==7&&(index>=9||value>1))||(action==8&&(index>1||value))||(action==9&&(index>=9||value>=9))||(action==10&&(index>=9||value))||(action==11&&(index||value>1))||(action==12&&(index||value<15||value>3600)))return false;
        queued={++serial,action,index,value};sent=false;state.busy=true;state.done=state.total=state.warnings=0;state.text="Request sent to MYGRAIN...";state.revision++;return true;
    }
    bool companion(const std::array<uint64_t,14>& f,std::string text){
        if(f[0]>1||f[1]>511||f[2]>876543210||f[3]>1||f[4]<15||f[4]>3600||f[5]>1||f[6]>3600||f[7]>UINT32_MAX||f[8]>1200000||f[9]>135000000||f[10]>134300000||f[11]>UINT32_MAX||f[12]>UINT32_MAX||f[13]>9007199254740991ull||text.size()>1000)return false;
        auto n=f[2];std::array<uint8_t,9> order{};uint32_t seen=0;for(int i=8;i>=0;i--){order[i]=n%10;n/=10;if(order[i]>8||(seen&(1u<<order[i])))return false;seen|=1u<<order[i];}if(n||seen!=511)return false;
        std::lock_guard<std::mutex> lock(mutex);auto& c=state.companion;c.supported=true;c.pot=f[0];c.mask=f[1];c.order=order;c.autoStore=f[3];c.interval=f[4];c.syncing=f[5];c.next=f[6];c.last=f[7];c.duration=f[8];c.wire=f[9];c.bytes=f[10];c.count=f[11];c.skipped=f[12];c.total=f[13];c.text=std::move(text);state.revision++;return true;
    }
    RemoteCommand next(){std::lock_guard<std::mutex> lock(mutex);if(sent)return {};sent=true;return queued;}
    bool update(uint32_t id,bool busy,uint32_t done,uint32_t total,uint32_t warnings,uint32_t enabled,uint32_t available,bool ready,std::string text){
        if(done>total||total>128||warnings>128||(enabled|available)>((1u<<remoteLayerCount)-1)||text.size()>420)return false;
        std::lock_guard<std::mutex> lock(mutex);if(queued.id&&id!=queued.id)return true;if(id>serial)return false;
        state.supported=true;state.id=id;state.ready=ready;state.busy=busy;state.done=done;state.total=total;state.warnings=warnings;state.enabled=enabled;state.available=available;state.text=std::move(text);state.revision++;
        if(queued.id&&!busy){queued={};sent=false;}return true;
    }
};
}
