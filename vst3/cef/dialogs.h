#pragma once
// Modeless helper-owned native dialogs: CEF/audio/IPC continue while they are open.
cef_jsdialog_callback_t* dialogCallback=nullptr;
cef_jsdialog_type_t dialogType=JSDIALOGTYPE_ALERT;
#ifdef _WIN32
HWND dialogWindow=nullptr,dialogEdit=nullptr;
#elif defined(__APPLE__)
NSAlert* dialogAlert=nil;NSTextField* dialogField=nil;MyGrainDialogAction* dialogAction=nil;
#endif
void dismissDialog(bool accepted,bool continueRequest=true){
 auto* callback=dialogCallback;dialogCallback=nullptr;
 std::string text;
#ifdef _WIN32
 if(dialogEdit){wchar_t value[2049]{};GetWindowTextW(dialogEdit,value,2049);cef_string_t s{};cef_string_wide_to_utf16(value,wcslen(value),&s);text=utf8(&s);cef_string_utf16_clear(&s);}
 if(dialogWindow)DestroyWindow(dialogWindow);dialogWindow=dialogEdit=nullptr;
#elif defined(__APPLE__)
 if(dialogField)text=dialogField.stringValue.UTF8String;[dialogAlert.window orderOut:nil];[dialogAlert release];dialogAlert=nil;[dialogField release];dialogField=nil;
#endif
 mapping.data->dialogKind.store(0,std::memory_order_release);
 if(callback){if(continueRequest){String value(text);callback->cont(callback,accepted,value);}callback->base.release(&callback->base);}
}
#ifdef _WIN32
std::wstring dialogWide(const std::string& s){String value(s);return std::wstring((wchar_t*)value.value.str,value.value.length);}
INT_PTR CALLBACK dialogProc(HWND w,UINT msg,WPARAM wp,LPARAM){
 if(msg==WM_COMMAND&&(LOWORD(wp)==IDOK||LOWORD(wp)==IDCANCEL)){dismissDialog(LOWORD(wp)==IDOK);return TRUE;}
 if(msg==WM_CLOSE){dismissDialog(false);return TRUE;}return FALSE;
}
#endif
void showDialog(cef_jsdialog_type_t type,const std::string& message,const std::string& initial,cef_jsdialog_callback_t* callback){
 if(dialogCallback){String empty("");callback->cont(callback,0,empty);return;}
 dialogCallback=callback;callback->base.add_ref(&callback->base);dialogType=type;
#ifdef _WIN32
 struct Template {DLGTEMPLATE dialog;WORD menu=0,klass=0,title=0;} temp{};
 temp.dialog.style=WS_POPUP|WS_CAPTION|WS_SYSMENU|DS_MODALFRAME|DS_CENTER;temp.dialog.cx=340;temp.dialog.cy=145;
 dialogWindow=CreateDialogIndirectParamW(GetModuleHandleW(nullptr),&temp.dialog,nullptr,dialogProc,0);
 if(!dialogWindow){dismissDialog(false);return;}
 SetWindowTextW(dialogWindow,L"MyGrain CEF");RECT rect{};GetClientRect(dialogWindow,&rect);const int width=rect.right,height=rect.bottom;
 auto label=CreateWindowExW(0,L"STATIC",dialogWide(message).c_str(),WS_CHILD|WS_VISIBLE,16,12,width-32,height-108,dialogWindow,nullptr,nullptr,nullptr);
 SendMessageW(label,WM_SETFONT,(WPARAM)GetStockObject(DEFAULT_GUI_FONT),TRUE);
 if(type==JSDIALOGTYPE_PROMPT){dialogEdit=CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",dialogWide(initial).c_str(),WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL,16,height-86,width-32,26,dialogWindow,(HMENU)1001,nullptr,nullptr);SendMessageW(dialogEdit,WM_SETFONT,(WPARAM)GetStockObject(DEFAULT_GUI_FONT),TRUE);SendMessageW(dialogEdit,EM_SETLIMITTEXT,2048,0);}
 CreateWindowExW(0,L"BUTTON",L"OK",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_DEFPUSHBUTTON,width-196,height-44,82,28,dialogWindow,(HMENU)IDOK,nullptr,nullptr);
 if(type!=JSDIALOGTYPE_ALERT)CreateWindowExW(0,L"BUTTON",L"Cancel",WS_CHILD|WS_VISIBLE|WS_TABSTOP,width-100,height-44,82,28,dialogWindow,(HMENU)IDCANCEL,nullptr,nullptr);
 ShowWindow(dialogWindow,SW_SHOWNORMAL);SetForegroundWindow(dialogWindow);SetFocus(dialogEdit?dialogEdit:GetDlgItem(dialogWindow,IDOK));if(dialogEdit)SendMessageW(dialogEdit,EM_SETSEL,0,-1);
#elif defined(__APPLE__)
 if(!dialogAction)dialogAction=[[MyGrainDialogAction alloc] init];
 dialogAlert=[[NSAlert alloc] init];dialogAlert.messageText=@"MyGrain CEF";dialogAlert.informativeText=[NSString stringWithUTF8String:message.c_str()];
 auto* ok=[dialogAlert addButtonWithTitle:@"OK"];ok.target=dialogAction;ok.action=@selector(accept:);ok.keyEquivalent=@"\r";
 if(type!=JSDIALOGTYPE_ALERT){auto* cancel=[dialogAlert addButtonWithTitle:@"Cancel"];cancel.target=dialogAction;cancel.action=@selector(cancel:);cancel.keyEquivalent=@"\e";}
 if(type==JSDIALOGTYPE_PROMPT){dialogField=[[NSTextField alloc] initWithFrame:NSMakeRect(0,0,420,26)];dialogField.stringValue=[NSString stringWithUTF8String:initial.c_str()];dialogAlert.accessoryView=dialogField;}
 [dialogAlert layout];dialogAlert.window.styleMask&=~NSWindowStyleMaskClosable;[dialogAlert.window center];[dialogAlert.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];if(dialogField){[dialogAlert.window makeFirstResponder:dialogField];[dialogField selectText:nil];}
#else
 dismissDialog(false);return;
#endif
 mapping.data->dialogKind.store(uint32_t(type)+1,std::memory_order_release);
}
void testDialogReply(bool accepted,const char* text){
 // Test host drives the actual native edit/button widgets. Disabled in normal launches.
#ifdef _WIN32
 if(dialogEdit)SetWindowTextW(dialogEdit,dialogWide(text).c_str());if(dialogWindow)SendMessageW(GetDlgItem(dialogWindow,accepted?IDOK:IDCANCEL),BM_CLICK,0,0);
#elif defined(__APPLE__)
 if(dialogField)dialogField.stringValue=[NSString stringWithUTF8String:text];if(dialogAlert){if(!accepted&&dialogAlert.buttons.count<2)dismissDialog(false);else [dialogAlert.buttons[accepted?0:1] performClick:nil];}
#endif
}
