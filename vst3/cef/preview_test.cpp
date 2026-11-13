#include "preview.h"
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
void check(bool value){if(!value)throw std::runtime_error("CEF preview invariant failed");}
int main(){
 auto audio=std::make_unique<mygrain::cef::PreviewAudio>();mygrain::cef::PreviewReader reader;
 float in[480],right[480];for(int i=0;i<480;i++){in[i]=float(i)/480;right[i]=-in[i];}const float* channels[]{in,right};
 audio->push(channels,2,480);double l[128]{},r[128]{};reader.mix(*audio,l,r,128,48000,false);check(l[100]==in[100]&&r[100]==right[100]);check(audio->read.load()==128);
 reader.mix(*audio,l,r,128,48000,true);check(audio->read.load()==audio->write.load());
 audio->push(channels,2,480);float fl[128]{},fr[128]{};reader.mix(*audio,fl,fr,128,96000,false);check(std::abs(fl[100]-in[50])<1e-6&&audio->read.load()==544);
 reader.mix(*audio,fl,fr,128,44100,true);for(int i=0;i<80;i++)audio->push(channels,2,480);check(audio->dropped.load()>0);reader.mix(*audio,fl,fr,128,48000,false);check(audio->write.load()-audio->read.load()<48000/8);
 reader.mix(*audio,fl,fr,128,48000,true);in[0]=std::numeric_limits<float>::quiet_NaN();audio->push(channels,1,480);float clean[128]{};reader.mix<float>(*audio,clean,nullptr,128,48000,false);for(auto value:clean)check(std::isfinite(value));check(clean[0]==0);
 std::cout<<"PASS CEF preview stereo/mono, float/double, resampling, offline discard, stale discard, bounded overflow and nonfinite sanitation\n";
}
