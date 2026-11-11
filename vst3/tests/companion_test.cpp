#include "core.h"
#include <cassert>
#include <iostream>
static void word(std::vector<uint8_t>& b,uint32_t n){for(int k=0;k<4;k++)b.push_back(n>>(8*k));}
int main(){
 using namespace mygrain;std::vector<uint8_t> base;for(auto n:{0x3150474du,1u,2u,4u})word(base,n);base.insert(base.end(),{'{','}',0x50,0x4b,3,4});assert(validProjectDocument(base));
 ProjectStore store;auto hash=projectCrc(base.data(),base.size());auto copy=base;assert(store.commit(std::move(copy),hash,false,0));assert(store.revision==1);copy=base;assert(!store.commit(std::move(copy),hash,false,0));assert(store.revision==1);
 std::vector<uint8_t> wire;for(auto n:{0x3150444du,1u,uint32_t(base.size()),1u,1u,0u,uint32_t(base.size())})word(wire,n);assert(expandProjectDelta(wire,base)==base);
 auto bad=wire;bad[24]++;assert(expandProjectDelta(bad,base).empty());bad=wire;bad.push_back(0);assert(expandProjectDelta(bad,base).empty());bad=wire;bad[16]=2;assert(expandProjectDelta(bad,base).empty());bad=wire;bad[20]=1;assert(expandProjectDelta(bad,base).empty());
 RemoteControl remote;assert(remote.update(0,false,0,0,0,0,33554431,true,"ready"));assert(!remote.request(6));std::array<uint64_t,14> f{{0,5,12345678,1,60,0,60,0,0,0,22,0,0,0}};assert(remote.companion(f,"ready"));auto invalid=f;invalid[2]=111111111;assert(!remote.companion(invalid,"bad"));invalid=f;invalid[4]=14;assert(!remote.companion(invalid,"bad"));
 assert(!remote.request(7,9,1)&&!remote.request(9,0,9)&&!remote.request(12,0,14)&&!remote.request(13));assert(remote.request(6,0,1));auto cmd=remote.next();assert(cmd.action==6);assert(remote.update(cmd.id,false,0,0,0,0,33554431,true,"done"));assert(remote.request(12,0,15));assert(remote.next().value==15);remote.disconnect();assert(!remote.get().companion.supported);
 std::cout<<"PASS delta validation, stale revision retention, companion bounds and native commands\n";
}
