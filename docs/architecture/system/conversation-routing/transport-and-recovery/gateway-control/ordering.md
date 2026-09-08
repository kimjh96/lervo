# Control and dispatch ordering

Discord Gateway control frames and application dispatch use separate ordered queues. Sequence, heartbeat acknowledgement, reconnect, and resume handling never wait for intent resolution or provider execution. Authenticated application dispatch remains ordered and retains its bounded session proof across reconnect, so a long response cannot create a false missed-heartbeat window that discards a following message.
