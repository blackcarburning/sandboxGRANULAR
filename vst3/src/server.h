#pragma once
#include "core.h"
#include <mutex>
#include <string>
#include <thread>
namespace mygrain {
class Server {
    Engine& engine;
    std::thread thread;
    std::atomic<bool> quit{false};
    std::atomic<uint16_t> boundPort{0};
    std::string key, allowedTestOrigin;
    void loop();
public:
    explicit Server(Engine& e, std::string testOrigin="");
    ~Server();
    bool start();
    void stop();
    uint16_t port() const { return boundPort.load(); }
    std::string token() const { return key; }
    std::string connection() const { return std::to_string(port())+"."+key; }
    std::string url() const { return std::string("https://openclaw.blackcarburning.com/mygrain/#")+(engine.fx?"fx=":"daw=")+connection(); }
};
}
