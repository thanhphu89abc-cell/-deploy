<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Xử lý yêu cầu pre-flight của trình duyệt
if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

// Tự động tải file .env nếu có thư viện Dotenv
$autoload_path = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoload_path)) {
    require_once $autoload_path;
    if (class_exists('Dotenv\Dotenv')) {
        $dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
        $dotenv->safeLoad();
    }
}

// [FALLBACK] Nếu thư viện Dotenv không tồn tại, tự đọc file .env
if (empty($_ENV) && file_exists(__DIR__ . '/.env')) {
    $lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0) {
            continue;
        }

        if (strpos($line, '=') !== false) {
            list($name, $value) = explode('=', $line, 2);
            $name = trim($name);
            $value = trim(trim($value), '"'); // Trim whitespace then quotes
            $_ENV[$name] = $value;
        }
    }
}

// [FIX] Bắt buộc kiểm tra cấu hình an ninh
if (empty($_ENV['JWT_SECRET_KEY'])) {
    http_response_code(500);
    die(json_encode([
        "message" => "LỖI CẤU HÌNH NGHIÊM TRỌNG: JWT_SECRET_KEY chưa được thiết lập. Vui lòng sao chép file '.env.example' thành file '.env' và đảm bảo bạn đã điền đầy đủ thông tin."
    ]));
}

$host = $_ENV['DB_HOST'] ?? 'localhost';
$user = $_ENV['DB_USER'] ?? 'root';
$password = $_ENV['DB_PASS'] ?? '';
$database = $_ENV['DB_NAME'] ?? 'coursera_advanced_db';
$port = isset($_ENV['DB_PORT']) ? (int)$_ENV['DB_PORT'] : 3307;

$conn = new mysqli($host, $user, $password, $database, $port);

if ($conn->connect_error) {
    http_response_code(500);
    die(json_encode(["message" => "Kết nối CSDL thất bại: " . $conn->connect_error . " (Host: $host, Port: $port)"]));
}
?>