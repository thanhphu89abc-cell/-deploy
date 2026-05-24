<?php

declare(strict_types=1);

mysqli_report(MYSQLI_REPORT_OFF);

/**
 * DATABASE CONFIG
 */
$db_host = "localhost";
$db_user = "root";
$db_pass = "";
$db_name = "coursera_advanced_db";
$db_port = 3307;

/**
 * MYSQLI CONNECT
 */
$conn = new mysqli(
    $db_host,
    $db_user,
    $db_pass,
    $db_name,
    $db_port
);

/**
 * CHECK CONNECTION
 */
if ($conn->connect_error) {
    if (ob_get_level()) ob_clean();
    http_response_code(500);
    die(json_encode(["message" => "Kết nối CSDL thất bại: " . $conn->connect_error]));
}
// Không để bất kỳ dấu cách hay thẻ ?>