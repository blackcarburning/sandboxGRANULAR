#pragma once
#include "ipc.h"
#include "pluginterfaces/base/keycodes.h"
namespace mygrain::cef {
// VST3 key codes/modifiers are NOT Windows virtual-key/CEF flag values.
inline int virtualKey(char16_t character,int code){
 using namespace Steinberg;
 switch(code){
 case KEY_BACK:return 8;case KEY_TAB:return 9;case KEY_CLEAR:return 12;
 case KEY_RETURN:case KEY_ENTER:return 13;case KEY_PAUSE:return 19;case KEY_ESCAPE:return 27;
 case KEY_SPACE:return 32;case KEY_PAGEUP:return 33;case KEY_PAGEDOWN:case KEY_NEXT:return 34;
 case KEY_END:return 35;case KEY_HOME:return 36;case KEY_LEFT:return 37;case KEY_UP:return 38;case KEY_RIGHT:return 39;case KEY_DOWN:return 40;
 case KEY_INSERT:return 45;case KEY_DELETE:return 46;case KEY_SHIFT:return 16;case KEY_CONTROL:return 17;case KEY_ALT:return 18;
 default:break;
 }
 if(code>=KEY_F1&&code<=KEY_F12)return 112+code-KEY_F1;
 if(code>=KEY_NUMPAD0&&code<=KEY_NUMPAD9)return 96+code-KEY_NUMPAD0;
 if(code>=VKEY_FIRST_ASCII){const auto c=Steinberg::VirtualKeyCodeToChar(uint8_t(code));if(c)return c;}
 if(character>='a'&&character<='z')return character-32;
 if(character==127)return 8;
 // Chromium expects OEM virtual keys for punctuation, not ASCII navigation codes.
 switch(character){case ';':case ':':return 186;case '=':case '+':return 187;case ',':case '<':return 188;case '-':case '_':return 189;case '.':case '>':return 190;case '/':case '?':return 191;case '`':case '~':return 192;case '[':case '{':return 219;case '\\':case '|':return 220;case ']':case '}':return 221;case '\'':case '"':return 222;}
 const char* shifted=")!@#$%^&*(";for(int i=0;i<10;++i)if(character==shifted[i])return '0'+i;
 return character<128?character:0;
}
inline uint32_t keyModifiers(int flags){
 using namespace Steinberg;uint32_t out=0;
 if(flags&kShiftKey)out|=2;if(flags&kAlternateKey)out|=8;
#ifdef __APPLE__
 if(flags&kCommandKey)out|=128;if(flags&kControlKey)out|=4;
#else
 if(flags&kCommandKey)out|=4;if(flags&kControlKey)out|=128;
#endif
 return out;
}
inline bool hostKey(Mapping& ipc,bool up,char16_t character,int code,int flags){
 const auto vk=virtualKey(character,code);if(!vk&&!character)return false;
 const auto modifiers=keyModifiers(flags);
 if(!ipc.push({up?KeyUp:KeyDown,int(character),0,vk,0,modifiers}))return false;
 // CEF OSR needs the text event in addition to the physical key event.
 // Unicode arrives from the host's layout; never derive passwords via ASCII key codes.
 if(!up&&character&&character!=127&&!(modifiers&(4|128)))ipc.push({Char,0,0,int(character),0,modifiers});
 return true;
}
}
