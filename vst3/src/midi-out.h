#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>

namespace mygrain {
class MidiOut {
    static constexpr size_t capacity=1024;
    struct Item {
        uint64_t frame=0, end=0;
        uint32_t epoch=0, revision=0, id=0;
        uint8_t lane=0, pitch=0, velocity=0;
        uint16_t expression=0;
    };
    struct Earlier {
        bool operator()(const Item& left,const Item& right) const {
            if(left.frame!=right.frame)return left.frame>right.frame;
            const auto priority=[](const Item& item){return item.expression?1:item.velocity?2:0;};
            if(priority(left)!=priority(right))return priority(left)>priority(right);
            return left.id>right.id;
        }
    };
    std::array<Item,capacity> ring{}, pending{};
    std::atomic<uint64_t> write{0},read{0};
    static constexpr unsigned lanes=4;
    std::array<std::atomic<uint32_t>,lanes> revisions{};
    std::array<std::array<Item,128>,lanes> sounding{};
    std::array<Item,130> expressions{};
    std::array<std::atomic<unsigned>,4> lfoValues{};
    size_t count=0;
    uint32_t serial=0;

    void add(Item item){pending[count++]=item;std::push_heap(pending.begin(),pending.begin()+count,Earlier{});}
    void pop(){std::pop_heap(pending.begin(),pending.begin()+count,Earlier{});--count;}
public:
    static constexpr uint32_t expressionFlag=0x80000000u;
    void setLfo(unsigned slot,unsigned value){if(slot<lfoValues.size()&&value<=128)lfoValues[slot].store(value);}
    void clearLfos(){for(auto& value:lfoValues)value.store(0);}
    template<class Emit> void processLfos(bool enabled,bool hasOutput,Emit emit){
        if(!enabled||!hasOutput)return;
        for(unsigned slot=0;slot<lfoValues.size();++slot){
            auto value=lfoValues[slot].load();
            if(value&&emit(0,3,102+slot,0,expressionFlag|(value-1)))lfoValues[slot].compare_exchange_strong(value,0);
        }
    }
    void cancel(unsigned lane){revisions[lane].fetch_add(1,std::memory_order_acq_rel);}
    bool push(uint32_t epoch,unsigned lane,unsigned pitch,unsigned velocity,uint64_t frame,uint64_t end,uint16_t expression=0){
        const auto index=write.load(std::memory_order_relaxed);
        if(index-read.load(std::memory_order_acquire)>=capacity){cancel(lane);return false;}
        if(++serial>0x7fffffffu)serial=1;
        ring[index%capacity]={frame,end,epoch,revisions[lane].load(std::memory_order_acquire),serial,
                              uint8_t(lane),uint8_t(pitch),uint8_t(velocity),expression};
        write.store(index+1,std::memory_order_release);return true;
    }
    template<class Emit> void process(uint64_t now,uint32_t frames,uint32_t epoch,bool enabled,bool hasOutput,Emit emit){
        const auto available=write.load(std::memory_order_acquire);
        std::array<uint32_t,lanes> revision{};
        std::array<bool,lanes> blocked{};
        for(unsigned lane=0;lane<lanes;++lane){
            revision[lane]=revisions[lane].load(std::memory_order_acquire);
            for(auto& note:sounding[lane])if(note.id&&(!enabled||note.epoch!=epoch||note.revision!=revision[lane])){
                if(hasOutput&&frames&&emit(0,note.lane,note.pitch,0,note.id))note={};
                else blocked[lane]=true;
            }
        }
        for(auto& item:expressions)if(item.id&&(!enabled||item.epoch!=epoch||item.revision!=revision[item.lane])){
            if(hasOutput&&frames&&emit(0,item.lane,item.pitch,0,expressionFlag|(item.pitch==129?8192u:0u)))item={};
            else blocked[item.lane]=true;
        }
        auto valid=[&](const Item& item){return enabled&&item.epoch==epoch&&item.revision==revision[item.lane];};
        auto end=std::remove_if(pending.begin(),pending.begin()+count,[&](const Item& item){return !valid(item);});
        if(end!=pending.begin()+count){count=size_t(end-pending.begin());std::make_heap(pending.begin(),end,Earlier{});}
        auto cursor=read.load(std::memory_order_relaxed);
        for(;cursor!=available;++cursor){const auto item=ring[cursor%capacity];if(valid(item)&&count<capacity)add(item);}
        read.store(cursor,std::memory_order_release);
        if(!hasOutput||!frames)return;
        while(count&&pending.front().frame<now+frames){
            const auto item=pending.front();
            const auto offset=uint32_t(item.frame>now?item.frame-now:0);
            if(item.expression){
                if(blocked[item.lane]){pop();continue;}
                if(!emit(offset,item.lane,item.pitch,0,expressionFlag|uint32_t(item.expression-1)))break;
                expressions[item.pitch]=item;pop();continue;
            }
            auto& note=sounding[item.lane][item.pitch];
            if(!item.velocity){
                if(note.id==item.id){if(!emit(offset,item.lane,item.pitch,0,item.id))break;note={};}
                pop();continue;
            }
            if(blocked[item.lane]||item.end<=now){pop();continue;}
            if(note.id){if(!emit(offset,item.lane,item.pitch,0,note.id))break;note={};}
            if(!emit(offset,item.lane,item.pitch,item.velocity,item.id))break;
            note=item;pop();
            auto off=item;off.frame=item.end;off.velocity=0;add(off);
        }
    }
};
}
