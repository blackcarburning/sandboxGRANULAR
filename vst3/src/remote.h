#pragma once
#include <mutex>
#include <string>
#include <cstdint>
#include <algorithm>
namespace mygrain {
constexpr unsigned remoteLayerCount=25;
constexpr const char* remoteLayerNames[]={"Reverb","Delay","Osc","Granular","Piano","Strings","N Noise","Sample","Loop","Loop A","Loop B","Loop C","Loop V","Loop D","Loop W","Loop P","Loop O","Loop L","Loop X","Loop Q","Loop M","Loop M+","Loop K","Dropbox","Drums"};
struct RemoteState {bool supported=false,ready=false,busy=false;uint32_t id=0,done=0,total=0,warnings=0,enabled=0,available=0,revision=0;std::string text="Connect Chrome for randomisation and layer controls.";};
struct RemoteCommand {uint32_t id=0,action=0,index=0,value=0;};
class RemoteControl {
    std::mutex mutex;RemoteState state;RemoteCommand queued;uint32_t serial=0;bool sent=false;
public:
    RemoteState get(){std::lock_guard<std::mutex> lock(mutex);return state;}
    void disconnect(){std::lock_guard<std::mutex> lock(mutex);state.supported=false;state.ready=false;state.busy=false;state.available=0;state.text="Chrome disconnected. Reconnect for patch controls.";state.revision++;queued={};sent=false;}
    bool request(uint32_t action,uint32_t index=0,uint32_t value=0){
        std::lock_guard<std::mutex> lock(mutex);if(!state.supported||!state.ready||state.busy||queued.id||action<1||action>5||(action==3&&(index>=remoteLayerCount||!(state.available&(1u<<index))||value>1)))return false;
        queued={++serial,action,index,value};sent=false;state.busy=true;state.done=state.total=state.warnings=0;state.text="Request sent to MYGRAIN...";state.revision++;return true;
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
