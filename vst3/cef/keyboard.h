#pragma once
#include "ipc.h"
#include "pluginterfaces/base/keycodes.h"
namespace mygrain::cef {
// Space belongs to the DAW unless Chromium is editing text. Keep the down/up
// pair (and native WM_CHAR) on one route, even if focus changes while held.
struct SpaceKey {
 bool held=false,toBrowser=false;
 bool toHost(const Mapping& ipc,int vk,bool up){
  if(vk!=32)return false;
  if(!held)toBrowser=ipc.data&&ipc.data->textEditing.load(std::memory_order_acquire);
  held=!up;return !toBrowser;
 }
};
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
// macOS CEF derives the key identity from NSEvent hardware codes, not windows_key_code.
inline int nativeKey(int vk){
#ifdef __APPLE__
 switch(vk){
 case 'A':return 0;case 'S':return 1;case 'D':return 2;case 'F':return 3;case 'H':return 4;case 'G':return 5;case 'Z':return 6;case 'X':return 7;case 'C':return 8;case 'V':return 9;case 'B':return 11;case 'Q':return 12;case 'W':return 13;case 'E':return 14;case 'R':return 15;case 'Y':return 16;case 'T':return 17;
 case '1':return 18;case '2':return 19;case '3':return 20;case '4':return 21;case '6':return 22;case '5':return 23;case '9':return 25;case '7':return 26;case '8':return 28;case '0':return 29;
 case 'O':return 31;case 'U':return 32;case 'I':return 34;case 'P':return 35;case 'L':return 37;case 'J':return 38;case 'K':return 40;case 'N':return 45;case 'M':return 46;
 case 187:return 24;case 189:return 27;case 221:return 30;case 219:return 33;case 222:return 39;case 186:return 41;case 220:return 42;case 188:return 43;case 191:return 44;case 190:return 47;case 192:return 50;
 case 13:return 36;case 9:return 48;case 32:return 49;case 8:return 51;case 27:return 53;case 35:return 119;case 36:return 115;case 33:return 116;case 34:return 121;case 37:return 123;case 38:return 126;case 39:return 124;case 40:return 125;case 46:return 117;
 default:return 0;
 }
#else
 return 0;
#endif
}
inline char16_t keyText(char16_t character,int vk){
 if(character)return character;
 if(vk>='A'&&vk<='Z')return char16_t(vk+32);
 if(vk>='0'&&vk<='9')return char16_t(vk);
#ifdef __APPLE__
 switch(vk){case 8:return 127;case 9:return 9;case 13:return 13;case 27:return 27;case 37:return 0xf702;case 38:return 0xf700;case 39:return 0xf703;case 40:return 0xf701;case 46:return 0xf728;case 36:return 0xf729;case 35:return 0xf72b;case 33:return 0xf72c;case 34:return 0xf72d;default:break;}
#endif
 return 0;
}
inline bool hostKey(Mapping& ipc,bool up,char16_t character,int code,int flags){
 const auto vk=virtualKey(character,code);if(!vk&&!character)return false;
 const auto modifiers=keyModifiers(flags);
 if(!ipc.push({up?KeyUp:KeyDown,int(keyText(character,vk)),0,vk,nativeKey(vk),modifiers}))return false;
 // CEF OSR needs the text event in addition to the physical key event.
 // Unicode arrives from the host's layout; never derive passwords via ASCII key codes.
 char16_t text=character;
#ifdef __APPLE__
 // Blink's macOS deletion commands require CHAR as well as key-down.
 if(vk==8||vk==46)text=keyText(character,vk);
 const bool characterEvent=text&&(text<0xf700||vk==46);
#else
 const bool characterEvent=text&&text!=127;
#endif
 if(!up&&characterEvent&&!(modifiers&128)&&!((modifiers&4)&&!(modifiers&8)))ipc.push({Char,0,0,int(text),nativeKey(vk),modifiers});
 return true;
}
}
