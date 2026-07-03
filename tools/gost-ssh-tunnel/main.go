package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	defaultPoolSize = 3
	maxPoolSize     = 8
	version         = "0.2.0"
)

type Config struct {
	Listen           string `json:"listen"`
	Host             string `json:"host"`
	Port             int    `json:"port"`
	Username         string `json:"username"`
	Password         string `json:"password"`
	PrivateKeyPath   string `json:"privateKeyPath"`
	PrivateKey       string `json:"privateKey"`
	Passphrase       string `json:"passphrase"`
	PoolSize         int    `json:"poolSize"`
	TimeoutMs        int    `json:"timeoutMs"`
	KeepAliveSeconds int    `json:"keepAliveSeconds"`
}

type clientEntry struct {
	client *ssh.Client
	active int64
	closed atomic.Bool
}

type tunnelServer struct {
	cfg     Config
	clients []*clientEntry
	next    uint64
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	configPath := flag.String("config", "", "path to JSON config")
	showVersion := flag.Bool("version", false, "print version")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	if *configPath == "" {
		log.Fatal("missing -config")
	}

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	server := &tunnelServer{cfg: cfg}
	if err := server.start(ctx); err != nil {
		log.Fatalf("start error: %v", err)
	}
	defer server.close()

	listener, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		log.Fatalf("listen error: %v", err)
	}
	defer listener.Close()

	log.Printf("ready listen=%s target=%s:%d pool=%d", cfg.Listen, cfg.Host, cfg.Port, len(server.clients))

	for {
		conn, err := listener.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			log.Printf("accept error: %v", err)
			continue
		}
		go server.handleConn(conn)
	}
}

func loadConfig(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}

	cfg.Listen = strings.TrimSpace(cfg.Listen)
	cfg.Host = strings.TrimSpace(cfg.Host)
	cfg.Username = strings.TrimSpace(cfg.Username)
	if cfg.Listen == "" {
		return Config{}, errors.New("listen is required")
	}
	if cfg.Host == "" {
		return Config{}, errors.New("host is required")
	}
	if cfg.Username == "" {
		return Config{}, errors.New("username is required")
	}
	if cfg.Port <= 0 || cfg.Port > 65535 {
		cfg.Port = 22
	}
	if cfg.PoolSize <= 0 {
		cfg.PoolSize = defaultPoolSize
	}
	if cfg.PoolSize > maxPoolSize {
		cfg.PoolSize = maxPoolSize
	}
	if cfg.TimeoutMs <= 0 {
		cfg.TimeoutMs = 15000
	}
	if cfg.KeepAliveSeconds <= 0 {
		cfg.KeepAliveSeconds = 15
	}
	if cfg.Password == "" && cfg.PrivateKeyPath == "" && cfg.PrivateKey == "" {
		return Config{}, errors.New("password or private key is required")
	}

	return cfg, nil
}

func (s *tunnelServer) start(ctx context.Context) error {
	type dialResult struct {
		client *ssh.Client
		err    error
	}

	log.Printf("ssh pool connecting target=%s:%d pool=%d", s.cfg.Host, s.cfg.Port, s.cfg.PoolSize)
	results := make(chan dialResult, s.cfg.PoolSize)
	for i := 0; i < s.cfg.PoolSize; i++ {
		go func() {
			client, err := dialSSH(s.cfg)
			results <- dialResult{client: client, err: err}
		}()
	}

	var firstErr error
	var clients []*ssh.Client
	for i := 0; i < s.cfg.PoolSize; i++ {
		result := <-results
		if result.err != nil {
			if firstErr == nil {
				firstErr = result.err
			}
			continue
		}
		clients = append(clients, result.client)
	}
	if firstErr != nil {
		for _, client := range clients {
			_ = client.Close()
		}
		return firstErr
	}

	for _, client := range clients {
		entry := &clientEntry{client: client}
		s.clients = append(s.clients, entry)
		go keepAlive(ctx, entry, time.Duration(s.cfg.KeepAliveSeconds)*time.Second)
	}
	log.Printf("ssh pool ready target=%s:%d pool=%d", s.cfg.Host, s.cfg.Port, len(s.clients))
	return nil
}

func (s *tunnelServer) close() {
	for _, entry := range s.clients {
		entry.closed.Store(true)
		_ = entry.client.Close()
	}
}

func dialSSH(cfg Config) (*ssh.Client, error) {
	authMethods, err := buildAuthMethods(cfg)
	if err != nil {
		return nil, err
	}

	clientConfig := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         time.Duration(cfg.TimeoutMs) * time.Millisecond,
	}

	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	return ssh.Dial("tcp", addr, clientConfig)
}

func buildAuthMethods(cfg Config) ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod
	if cfg.Password != "" {
		methods = append(methods, ssh.Password(cfg.Password))
	}

	key := strings.TrimSpace(cfg.PrivateKey)
	if key == "" && cfg.PrivateKeyPath != "" {
		data, err := os.ReadFile(cfg.PrivateKeyPath)
		if err != nil {
			return nil, err
		}
		key = string(data)
	}
	if key != "" {
		var signer ssh.Signer
		var err error
		if cfg.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(key), []byte(cfg.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(key))
		}
		if err != nil {
			return nil, err
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}

	if len(methods) == 0 {
		return nil, errors.New("no SSH auth method configured")
	}
	return methods, nil
}

func keepAlive(ctx context.Context, entry *clientEntry, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if entry.closed.Load() {
				return
			}
			_, _, err := entry.client.SendRequest("keepalive@openssh.com", true, nil)
			if err != nil {
				entry.closed.Store(true)
				_ = entry.client.Close()
				return
			}
		}
	}
}

func (s *tunnelServer) pickClient() *clientEntry {
	var selected *clientEntry
	for _, entry := range s.clients {
		if entry.closed.Load() {
			continue
		}
		if selected == nil || atomic.LoadInt64(&entry.active) < atomic.LoadInt64(&selected.active) {
			selected = entry
		}
	}
	if selected != nil {
		return selected
	}

	for i := 0; i < len(s.clients); i++ {
		idx := int(atomic.AddUint64(&s.next, 1)) % len(s.clients)
		entry := s.clients[idx]
		if !entry.closed.Load() {
			return entry
		}
	}
	return nil
}

func (s *tunnelServer) handleConn(conn net.Conn) {
	defer conn.Close()
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
	}

	target, err := readSocks5Target(conn)
	if err != nil {
		writeSocks5Reply(conn, 0x01)
		return
	}

	entry := s.pickClient()
	if entry == nil {
		writeSocks5Reply(conn, 0x01)
		return
	}

	atomic.AddInt64(&entry.active, 1)
	defer atomic.AddInt64(&entry.active, -1)

	remote, err := entry.client.Dial("tcp", target)
	if err != nil {
		writeSocks5Reply(conn, 0x05)
		return
	}
	defer remote.Close()
	if tcpConn, ok := remote.(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
	}

	if err := writeSocks5Reply(conn, 0x00); err != nil {
		return
	}

	pipeBoth(conn, remote)
}

func readSocks5Target(conn net.Conn) (string, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(conn, header); err != nil {
		return "", err
	}
	if header[0] != 0x05 {
		return "", errors.New("unsupported SOCKS version")
	}
	methods := make([]byte, int(header[1]))
	if _, err := io.ReadFull(conn, methods); err != nil {
		return "", err
	}
	if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
		return "", err
	}

	req := make([]byte, 4)
	if _, err := io.ReadFull(conn, req); err != nil {
		return "", err
	}
	if req[0] != 0x05 || req[1] != 0x01 {
		return "", errors.New("only SOCKS CONNECT is supported")
	}

	host, err := readSocksAddr(conn, req[3])
	if err != nil {
		return "", err
	}
	portBytes := make([]byte, 2)
	if _, err := io.ReadFull(conn, portBytes); err != nil {
		return "", err
	}
	port := binary.BigEndian.Uint16(portBytes)
	return net.JoinHostPort(host, strconv.Itoa(int(port))), nil
}

func readSocksAddr(conn net.Conn, atyp byte) (string, error) {
	switch atyp {
	case 0x01:
		buf := make([]byte, net.IPv4len)
		if _, err := io.ReadFull(conn, buf); err != nil {
			return "", err
		}
		return net.IP(buf).String(), nil
	case 0x03:
		lenBuf := make([]byte, 1)
		if _, err := io.ReadFull(conn, lenBuf); err != nil {
			return "", err
		}
		buf := make([]byte, int(lenBuf[0]))
		if _, err := io.ReadFull(conn, buf); err != nil {
			return "", err
		}
		return string(buf), nil
	case 0x04:
		buf := make([]byte, net.IPv6len)
		if _, err := io.ReadFull(conn, buf); err != nil {
			return "", err
		}
		return net.IP(buf).String(), nil
	default:
		return "", fmt.Errorf("unsupported address type: %d", atyp)
	}
}

func writeSocks5Reply(conn net.Conn, code byte) error {
	_, err := conn.Write([]byte{0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
	return err
}

func pipeBoth(left net.Conn, right net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		_, _ = io.Copy(left, right)
		closeWrite(left)
	}()

	go func() {
		defer wg.Done()
		_, _ = io.Copy(right, left)
		closeWrite(right)
	}()

	wg.Wait()
}

type closeWriter interface {
	CloseWrite() error
}

func closeWrite(conn net.Conn) {
	if cw, ok := conn.(closeWriter); ok {
		_ = cw.CloseWrite()
		return
	}
	_ = conn.Close()
}
