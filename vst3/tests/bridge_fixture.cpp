#include "server.h"
#include <chrono>
#include <fstream>
#include <iostream>
#include <thread>
#include <cstdlib>
int main(int argc,char** argv){
    mygrain::Engine e;mygrain::Server s(e,argc>1?argv[1]:"http://127.0.0.1:19109");s.start();
    for(int i=0;i<500&&!s.port();++i)std::this_thread::sleep_for(std::chrono::milliseconds(2));
    if(!s.port())return 2;std::cout<<s.connection()<<std::endl;
    const double seconds=argc>2?std::atof(argv[2]):30.;
    std::ofstream audio;if(argc>3)audio.open(argv[3],std::ios::binary);
    mygrain::HostBlock host;host.playing=true;host.musicalValid=true;host.timingValid=true;
    auto start=std::chrono::steady_clock::now(),next=start;float l[128]{},r[128]{};
    while(std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<seconds){
        host.projectSample=e.clock.load();host.ppq=host.projectSample*120./(60*48000);
        e.process(l,r,128,host);if(audio){for(int i=0;i<128;++i){audio.write((char*)&l[i],4);audio.write((char*)&r[i],4);}}
        next+=std::chrono::nanoseconds(2666667);std::this_thread::sleep_until(next);
    }
    std::cout<<"frames="<<e.received<<" underruns="<<e.underflows<<" overflows="<<e.overflows<<std::endl;
}
