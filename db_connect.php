<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Xử lý yêu cầu pre-flight của trình duyệt
if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

$host = "localhost";
$user = "root";
$password = "";
$database = "coursera_advanced_db";
$port = 3307;

$conn = new mysqli($host, $user, $password, $database, $port);

if ($conn->connect_error) {
    http_response_code(500);
    die(json_encode(["message" => "Kết nối CSDL thất bại: " . $conn->connect_error]));
}
?>