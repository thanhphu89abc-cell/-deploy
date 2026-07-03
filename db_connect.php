<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

$autoload_path = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoload_path)) {
    require_once $autoload_path;
    if (class_exists('Dotenv\Dotenv')) {
        $dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
        $dotenv->safeLoad();
    }
}

if (empty($_ENV) && file_exists(__DIR__ . '/.env')) {
    $lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0) {
            continue;
        }

        if (strpos($line, '=') !== false) {
            list($name, $value) = explode('=', $line, 2);
            $name = trim($name);
            $value = trim(trim($value), '"');
            $_ENV[$name] = $value;
        }
    }
}

// Railway may expose variables via process env rather than populating $_ENV.
$jwtSecret = $_ENV['JWT_SECRET_KEY'] ?? getenv('JWT_SECRET_KEY') ?: '';
if ($jwtSecret === '') {
    http_response_code(500);
    die(json_encode([
        "message" => "LOI CAU HINH NGHIEM TRONG: JWT_SECRET_KEY chua duoc thiet lap."
    ]));
}
$_ENV['JWT_SECRET_KEY'] = $jwtSecret;

$host = $_ENV['DB_HOST'] ?? $_ENV['MYSQLHOST'] ?? getenv('DB_HOST') ?: getenv('MYSQLHOST') ?: 'localhost';
$user = $_ENV['DB_USER'] ?? $_ENV['MYSQLUSER'] ?? getenv('DB_USER') ?: getenv('MYSQLUSER') ?: 'root';
$password = $_ENV['DB_PASS'] ?? $_ENV['MYSQLPASSWORD'] ?? getenv('DB_PASS') ?: getenv('MYSQLPASSWORD') ?: '';
$database = $_ENV['DB_NAME'] ?? $_ENV['MYSQLDATABASE'] ?? getenv('DB_NAME') ?: getenv('MYSQLDATABASE') ?: 'coursera_advanced_db';

if (isset($_ENV['DB_PORT'])) {
    $port = (int) $_ENV['DB_PORT'];
} elseif (isset($_ENV['MYSQLPORT'])) {
    $port = (int) $_ENV['MYSQLPORT'];
} elseif (getenv('DB_PORT') !== false && getenv('DB_PORT') !== '') {
    $port = (int) getenv('DB_PORT');
} elseif (getenv('MYSQLPORT') !== false && getenv('MYSQLPORT') !== '') {
    $port = (int) getenv('MYSQLPORT');
} else {
    $port = 3307;
}

$conn = new mysqli($host, $user, $password, $database, $port);

if ($conn->connect_error) {
    http_response_code(500);
    die(json_encode([
        "message" => "Ket noi CSDL that bai: " . $conn->connect_error . " (Host: $host, Port: $port)"
    ]));
}
?>
