// Isolated real-time core fixture: control file play/stop/quit; stdout PCM metrics.
#include "server.h"
#include <chrono>
#include <fstream>
#include <iostream>
#include <thread>
#include <cmath>
#include <cstdlib>
int main(int argc,char**argv){
 if(argc!=3)return 2;
 mygrain::Engine e;mygrain::Server s(e,argv[1]);s.start();for(int i=0;i<500&&!s.port();i++)std::this_thread::sleep_for(std::chrono::milliseconds(2));if(!s.port())return 2;std::cout<<s.connection()<<std::endl;
 mygrain::HostBlock h;h.rate=48000;h.tempo=102;h.musicalValid=true;h.timingValid=true;h.playing=false;auto begin=std::chrono::steady_clock::now(),next=begin;float l[128]{},r[128]{};double beat=0,peak=0;uint64_t nonzero=0,blocks=0;std::string previous;
 while(std::chrono::duration<double>(std::chrono::steady_clock::now()-begin).count()<180){std::ifstream c(argv[2]);std::string command;std::getline(c,command);if(command!=previous){previous=command;if(command=="quit")break;if(command=="play"){h.playing=true;e.requestArm();}if(command=="stop"){h.playing=false;e.requestStop();}}h.ppq=std::fmod(beat,8.);h.projectSample=std::llround(h.ppq*60./h.tempo*h.rate);e.process(l,r,128,h);if(h.playing)beat+=128*h.tempo/(60*h.rate);for(int i=0;i<128;i++){peak=std::max(peak,double(std::abs(l[i])));if(std::abs(l[i])>1e-6||std::abs(r[i])>1e-6)nonzero++;}if(++blocks%375==0)std::cout<<"{\"received\":"<<e.received<<",\"underruns\":"<<e.underflows<<",\"epoch\":"<<e.generation<<",\"running\":"<<(e.running?"true":"false")<<",\"peak\":"<<peak<<",\"nonzeroFrames\":"<<nonzero<<"}"<<std::endl;next+=std::chrono::nanoseconds(2666667);std::this_thread::sleep_until(next);}
}
