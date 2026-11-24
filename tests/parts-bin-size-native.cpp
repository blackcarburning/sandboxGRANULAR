// Real native ProjectStore admission/atomicity; not a DAW host or CEF UI test.
#include <fstream>
#include <iterator>
#include <iostream>
#include <cassert>
#include "../vst3/src/prepared.h"
#include "../vst3/src/project.h"
int main(int argc,char** argv){
 assert(argc==2);
 std::ifstream input(argv[1],std::ios::binary);
 std::vector<uint8_t> document((std::istreambuf_iterator<char>(input)),{});
 assert(document.size()>96u*1024*1024&&document.size()<128u*1024*1024);
 assert(mygrain::validProjectDocument(document));
 const auto crc=mygrain::projectCrc(document.data(),document.size());
 mygrain::ProjectStore store;
 assert(store.commit(std::move(document),crc,false));
 const auto completed=store.get();assert(completed);
 assert(store.revision.load()==1);
 // Reject a truly over-capacity replacement; the previous native state survives.
 std::vector<uint8_t> oversized(129u*1024*1024);
 assert(!store.commit(std::move(oversized),0,false));
 assert(store.get()==completed&&store.revision.load()==1);
 // A corrupt transfer likewise cannot replace the acknowledged project.
 auto corrupt=completed->document;corrupt.back()^=1;
 assert(!store.commit(std::move(corrupt),crc,false));
 assert(store.get()==completed&&store.revision.load()==1);
 mygrain::ProjectStore fresh;fresh.restore(completed);
 assert(fresh.get()->document==completed->document&&fresh.recallPending.load());
 std::cout<<"PASS native ProjectStore: >96 MiB commit, fresh store restore, >128 MiB and bad CRC preserve prior snapshot\n";
}
