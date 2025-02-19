export async function GET() {
  try {
    const client = await pool.connect();

    try {
      const result = await client.query(
        'SELECT * FROM templates ORDER BY template_added DESC',
      );

      return NextResponse.json({ templates: result.rows }, { status: 200 });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching templates:', error);

    return NextResponse.json(
      { message: 'Failed to fetch templates', error: error.message },
      { status: 500 },
    );
  }
}
