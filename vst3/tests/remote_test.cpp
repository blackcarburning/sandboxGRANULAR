// Standalone: c++ -std=c++17 -pthread -Isrc tests/remote_test.cpp -o /tmp/mygrain-remote-test
#include "remote.h"
#include <cassert>
int main(){
 mygrain::RemoteControl remote;
 assert(!remote.request(1));
 assert(!remote.update(0,false,3,2,0,0,0,true,"invalid progress"));
 assert(!remote.update(0,false,0,129,0,0,0,true,"invalid jobs"));
 assert(!remote.update(0,false,0,0,0,1u<<25,0,true,"invalid mask"));
 assert(!remote.update(0,false,0,0,0,0,0,true,std::string(421,'x')));
 assert(remote.update(0,false,0,0,0,0,1u<<9,true,"ready"));
 assert(!remote.request(0)&&!remote.request(6));
 assert(!remote.request(3,25,1)&&!remote.request(3,9,2)&&!remote.request(3,8,1));
 assert(remote.request(3,9,1)&&!remote.request(1));
 auto first=remote.next();assert(first.id&&first.action==3&&first.index==9&&first.value==1);
 assert(!remote.next().id);
 assert(remote.update(0,false,0,0,0,0,0,true,"stale heartbeat ignored"));
 assert(remote.get().busy);
 assert(remote.update(first.id,true,1,3,0,0,1u<<9,false,"loading"));
 assert(!remote.request(2));
 assert(remote.update(first.id,false,3,3,1,1u<<9,1u<<9,true,"complete"));
 assert(remote.get().done==3&&remote.get().warnings==1);
 assert(remote.request(2));auto second=remote.next();assert(second.id>first.id);
 remote.disconnect();assert(!remote.next().id&&!remote.request(1));
 assert(!remote.get().supported&&!remote.get().ready&&!remote.get().busy);
 assert(remote.update(0,false,0,0,0,0,1u<<9,true,"new connection"));
 assert(remote.request(1));assert(remote.next().id>second.id);
 mygrain::RemoteControl other;assert(!other.get().supported&&!other.next().id);
}
