#include "midi-out.h"
#include <cassert>
#include <iostream>
#include <tuple>
#include <vector>

int main(){
    mygrain::MidiOut midi;
    using Event=std::tuple<int,int,int,int>;
    std::vector<Event> events;
    bool accept=true;
    auto process=[&](uint64_t now,uint32_t frames,uint32_t epoch=5,bool enabled=true,bool output=true){
        midi.process(now,frames,epoch,enabled,output,[&](int offset,int lane,int pitch,int velocity,uint32_t id){
            assert(id>0&&offset>=0&&offset<int(frames));
            if(accept)events.emplace_back(offset,lane,pitch,velocity);
            return accept;
        });
    };
    assert(midi.push(5,1,53,80,142,195));
    assert(midi.push(5,2,60,92,135,152));
    assert(midi.push(5,2,64,92,135,165));
    assert(midi.push(5,0,48,84,129,142));
    assert(midi.push(5,0,48,75,142,160));
    assert(midi.push(4,0,67,84,129,142));
    process(128,32);
    assert((events==std::vector<Event>{{1,0,48,84},{7,2,60,92},{7,2,64,92},{14,0,48,0},{14,1,53,80},{14,0,48,75},{24,2,60,0}}));
    events.clear();
    midi.cancel(1);
    assert(midi.push(5,1,56,82,161,196));
    process(160,16);
    assert((events==std::vector<Event>{{0,1,53,0},{0,0,48,0},{1,1,56,82},{5,2,64,0}}));
    events.clear();
    assert(midi.push(5,0,50,75,200,250));
    process(176,16,6,false,false);
    accept=false;process(192,16,6,false);
    accept=true;process(208,16,6,false);
    assert((events==std::vector<Event>{{0,1,56,0}}));
    events.clear();
    assert(midi.push(6,0,60,84,220,224));
    assert(midi.push(6,0,61,84,220,245));
    process(224,32,6);
    assert((events==std::vector<Event>{{0,0,61,84},{21,0,61,0}}));
    std::vector<std::tuple<unsigned,unsigned,unsigned,unsigned>> expression;
    assert(midi.push(6,3,70,99,260,300));
    assert(midi.push(6,3,129,0,260,260,12501));
    assert(midi.push(6,3,1,0,260,260,128));
    auto capture=[&](unsigned offset,unsigned lane,unsigned key,unsigned velocity,unsigned id){
        assert(lane==3);expression.emplace_back(offset,key,velocity,(id&mygrain::MidiOut::expressionFlag)?id&16383:0);return true;};
    midi.process(256,16,6,true,true,capture);
    assert((expression==decltype(expression){{4,129,0,12500},{4,1,0,127},{4,70,99,0}}));
    expression.clear();midi.cancel(3);midi.process(272,16,6,true,true,capture);
    assert((expression==decltype(expression){{0,70,0,0},{0,1,0,0},{0,129,0,8192}}));
    mygrain::MidiOut split;
    std::vector<Event> delivered;
    int lastOffset=0;
    auto ordered=[&](int offset,int lane,int key,int velocity,uint32_t id){
        assert(offset>=lastOffset);lastOffset=offset;
        delivered.emplace_back(offset,lane,key,id&mygrain::MidiOut::expressionFlag?int(id&127):velocity);
        return true;
    };
    for(unsigned slot=0;slot<4;++slot)split.setLfo(slot,64+slot);
    split.processBlock(384,32,6,false,true,true,ordered);
    assert((delivered==std::vector<Event>{{0,0,102,63},{1,1,103,64},{2,2,104,65},{3,3,105,66}}));
    delivered.clear();
    lastOffset=0;
    for(unsigned slot=0;slot<4;++slot)split.setLfo(slot,80+slot);
    split.setLfo(1,0);
    assert(split.push(6,3,60,90,432,450));
    split.processBlock(416,32,6,true,true,true,ordered);
    assert((delivered==std::vector<Event>{{0,0,102,79},{1,2,104,81},{2,3,105,82},{16,3,60,90}}));

    // Exercise the production block dispatcher, not separate permissive drains.
    // A host which coalesces simultaneous controller timestamps must still see
    // every live CC; this models that compatibility risk, not Cubase itself.
    for(unsigned frames:{1u,2u,3u,4u,64u,512u,2048u}){
        mygrain::MidiOut concurrent;
        std::array<unsigned,4> received{},lastValue{};
        for(unsigned block=0;block<400;++block){
            const unsigned disabled=block>=200&&block<360?(block-200)/40:4;
            for(unsigned slot=0;slot<4;++slot)concurrent.setLfo(slot,slot==disabled?0:1+(block+slot*17)%128);
            const unsigned epoch=1+block/100;
            const uint64_t start=uint64_t(block)*frames;
            if(frames>=64){
                assert(concurrent.push(epoch,3,60,90,start+16,start+29));
                assert(concurrent.push(epoch,3,74,0,start,start,64));
                assert(concurrent.push(epoch,3,129,0,start,start,8193));
            }
            std::vector<Event> blockEvents;
            std::vector<std::pair<unsigned,bool>> ccOffsets;
            unsigned noteOns=0,noteOffs=0;int last=-1;
            concurrent.processBlock(start,frames,epoch,frames>=64,true,true,[&](unsigned offset,unsigned channel,unsigned key,unsigned velocity,uint32_t id){
                assert(offset<frames&&int(offset)>=last);last=int(offset);
                if(id&mygrain::MidiOut::expressionFlag){
                    if(key<128){
                        const bool live=key>=102&&key<=105;
                        for(auto seen:ccOffsets)if(live||seen.second)assert(seen.first!=offset);
                        ccOffsets.emplace_back(offset,live);
                    }
                    if(key>=102&&key<=105){
                        const auto slot=key-102;assert(channel==slot&&slot!=disabled);
                        assert((id&127u)==(block+slot*17)%128);
                        ++received[slot];lastValue[slot]=block;
                        blockEvents.emplace_back(offset,channel,key,id&127u);
                    }
                }else{
                    assert(channel==3&&key==60);
                    if(velocity){assert(offset==16);++noteOns;}else{assert(offset==29);++noteOffs;}
                }
                return true;
            });
            if(frames>=64){assert(noteOns==1&&noteOffs==1);assert(blockEvents.size()==(disabled<4?3u:4u));}
            if(block>=4&&(block<200||block%40>=4))for(unsigned slot=0;slot<4;++slot)if(slot!=disabled)assert(block-lastValue[slot]<4);
        }
        for(auto count:received)assert(count>=80);
    }
    // Rejection of one stream must not stop siblings, and a concurrent producer
    // update must not be erased when the callback acknowledges an older value.
    mygrain::MidiOut retry;
    for(unsigned slot=0;slot<4;++slot)retry.setLfo(slot,30+slot);
    unsigned accepted=0;
    retry.processBlock(0,64,1,false,true,true,[&](unsigned,unsigned lane,unsigned,unsigned,uint32_t){if(lane==0)return false;++accepted;return true;});
    assert(accepted==3);
    retry.processBlock(64,64,1,false,true,true,[&](unsigned,unsigned lane,unsigned,unsigned,uint32_t id){assert(lane==0&&(id&127u)==29);retry.setLfo(0,100);return true;});
    accepted=0;
    retry.processBlock(128,64,1,false,true,true,[&](unsigned,unsigned lane,unsigned,unsigned,uint32_t id){assert(lane==0&&(id&127u)==99);++accepted;return true;});
    assert(accepted==1);
    std::cout<<"PASS card MIDI: notes/expression and independent split LFOs, distinct CC timestamps, 2800 blocks, tiny-block fairness, epoch changes, toggles and rejected-output retry\n";
}
