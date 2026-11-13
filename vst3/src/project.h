#pragma once
#include <array>
#include <vector>
#include <memory>
#include <mutex>
#include <atomic>
#include <cstring>
#include <cmath>
#include <algorithm>
namespace mygrain {
constexpr uint32_t maxProjectBytes=128u*1024*1024+65552;
inline uint32_t projectCrc(const void* data,size_t n){
    static const auto table=[] {std::array<uint32_t,256> t{};for(uint32_t i=0;i<256;++i){uint32_t c=i;for(int k=0;k<8;++k)c=(c>>1)^((c&1)?0xedb88320u:0);t[i]=c;}return t;}();
    auto* p=static_cast<const uint8_t*>(data);uint32_t c=~0u;while(n--)c=table[(c^*p++)&255]^(c>>8);return ~c;
}
inline uint32_t projectWord(const uint8_t* p){return uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);}
inline bool validProjectDocument(const std::vector<uint8_t>& bytes){
    if(bytes.size()<20||bytes.size()>maxProjectBytes||projectWord(bytes.data())!=0x3150474d||projectWord(bytes.data()+4)!=1)return false;
    auto settings=projectWord(bytes.data()+8),zip=projectWord(bytes.data()+12);
    return settings>1&&settings<=65536&&zip>=4&&zip<=128u*1024*1024&&uint64_t(settings)+zip+16==bytes.size()&&projectWord(bytes.data()+16+settings)==0x04034b50;
}
// Delta wire is metadata/literal spans plus copies from an immutable saved document.
// It is decoded and CRC-checked away from both audio and socket servicing threads.
inline std::vector<uint8_t> expandProjectDelta(const std::vector<uint8_t>& wire,const std::vector<uint8_t>& base){
    if(wire.size()<16||projectWord(wire.data())!=0x3150444d||projectWord(wire.data()+4)!=1)return {};
    const uint32_t size=projectWord(wire.data()+8),count=projectWord(wire.data()+12);
    if(size<20||size>maxProjectBytes||!count||count>512)return {};
    std::vector<uint8_t> out(size);size_t p=16,cursor=0;
    for(uint32_t i=0;i<count;i++){
        if(p+12>wire.size())return {};auto kind=projectWord(wire.data()+p),offset=projectWord(wire.data()+p+4),n=projectWord(wire.data()+p+8);p+=12;
        if(!n||uint64_t(cursor)+n>size||kind>1)return {};
        if(kind){if(uint64_t(offset)+n>base.size())return {};std::memcpy(out.data()+cursor,base.data()+offset,n);}
        else{if(offset||p+n>wire.size())return {};std::memcpy(out.data()+cursor,wire.data()+p,n);p+=n;}
        cursor+=n;
    }
    if(p!=wire.size()||cursor!=size)return {};return out;
}
struct SavedLoop {std::vector<float> pcm;uint32_t rate=0;double beats=0,bpm=120;};
inline bool validSavedLoop(const SavedLoop& loop){
    if(loop.pcm.empty()||loop.pcm.size()%2||loop.pcm.size()/2>maxPreparedFrames||loop.rate<8000||loop.rate>192000||!std::isfinite(loop.beats)||loop.beats<1||loop.beats>64||!std::isfinite(loop.bpm)||loop.bpm<1||loop.bpm>300||std::abs(double(loop.pcm.size()/2)-loop.beats*60./loop.bpm*loop.rate)>2)return false;
    return std::all_of(loop.pcm.begin(),loop.pcm.end(),[](float v){return std::isfinite(v)&&std::abs(v)<=16;});
}
struct SavedProject {std::vector<uint8_t> document;std::shared_ptr<const SavedLoop> loop;uint32_t crc=0;bool rendered=false;};
// Only state/socket/UI threads touch these objects. process() reads atomic flags,
// never a mutex or shared_ptr (including its potentially large destructor).
class ProjectStore {
    std::mutex mutex;std::shared_ptr<const SavedProject> committed;std::shared_ptr<const SavedLoop> latest;
public:
    std::atomic<uint32_t> revision{0},bytes{0},dirtyRevision{0},dirtyNotified{0};
    std::atomic<bool> rendered{false},recallPending{false},supportsDirty{false};
    std::shared_ptr<const SavedProject> get(){std::lock_guard<std::mutex> lock(mutex);return committed;}
    void rememberLoop(std::shared_ptr<const SavedLoop> loop){std::lock_guard<std::mutex> lock(mutex);latest=std::move(loop);}
    bool commit(std::vector<uint8_t>&& document,uint32_t crc,bool useRender,uint32_t expectedRevision=UINT32_MAX){
        if(!validProjectDocument(document)||projectCrc(document.data(),document.size())!=crc)return false;
        auto value=std::make_shared<SavedProject>();value->document=std::move(document);value->crc=crc;value->rendered=useRender;
        std::lock_guard<std::mutex> lock(mutex);if(expectedRevision!=UINT32_MAX&&revision.load()!=expectedRevision)return false;if(useRender){if(!latest)return false;value->loop=latest;}
        committed=value;bytes.store(uint32_t(value->document.size()));rendered.store(useRender);recallPending.store(false);revision.fetch_add(1,std::memory_order_release);dirtyRevision.fetch_add(1,std::memory_order_release);return true;
    }
    void restore(std::shared_ptr<const SavedProject> value){
        std::lock_guard<std::mutex> lock(mutex);committed=std::move(value);latest=committed?committed->loop:nullptr;
        bytes.store(committed?uint32_t(committed->document.size()):0);rendered.store(committed&&committed->rendered);recallPending.store(bool(committed));revision.fetch_add(1,std::memory_order_release);
    }
};
}
