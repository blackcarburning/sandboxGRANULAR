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
    std::cout<<"PASS card MIDI: three channels, chords, exact offsets, retrigger order, cancellation, epoch reset, failed note-off retry and expired-note rejection\n";
}
